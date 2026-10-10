import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import { activeTask, type LogEntry, type LogStream, type TaskKind, type TaskRecord } from './types.ts';
import { signalTree } from './process.ts';

export interface LaunchSpec {
  kind: TaskKind; title: string; cwd: string; command: string; executable: string; args: string[];
  env?: NodeJS.ProcessEnv; input?: string; model?: string; timeoutMs?: number;
  transform?: (stream: 'stdout' | 'stderr', text: string) => { stream: LogStream; text: string }[];
  summarize?: () => { result?: string; error?: string };
}
interface Owned { child: ChildProcess; done: Promise<TaskRecord>; resolve: (t: TaskRecord)=>void; timeout?: NodeJS.Timeout; escalation?: NodeJS.Timeout; stopPromise?: Promise<TaskRecord>; reason?: 'stopped' | 'timed_out'; bytes: number; memory: number; seq: number; finished: boolean }
export const cleanOutput = (text:string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\r/g,'');
export class TaskManager {
  private tasks = new Map<string,TaskRecord>();
  private owned = new Map<string,Owned>();
  private listeners = new Set<()=>void>();
  private completions = new Set<(task:TaskRecord)=>void>();
  private closed = false;
  private maxConcurrent: number; private maxMemoryBytes: number; private maxLogBytes: number;
  constructor(private options: { logDir: string; maxConcurrent?: number; maxMemoryBytes?: number; maxLogBytes?: number }) {
    this.maxConcurrent=options.maxConcurrent ?? 4; this.maxMemoryBytes=options.maxMemoryBytes ?? 256*1024; this.maxLogBytes=options.maxLogBytes ?? 2*1024*1024;
    mkdirSync(options.logDir,{recursive:true,mode:0o700});
  }
  list(): TaskRecord[] { return [...this.tasks.values()]; }
  get(id:string): TaskRecord | undefined { return this.tasks.get(id); }
  subscribe(listener:()=>void):()=>void { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; }
  onComplete(listener:(task:TaskRecord)=>void):()=>void { this.completions.add(listener); return ()=>{this.completions.delete(listener);}; }
  private changed() { for(const f of this.listeners) { try {f();} catch {} } }
  start(spec:LaunchSpec):TaskRecord {
    if(this.closed) throw new Error('Task manager is closed');
    if(this.list().filter(activeTask).length>=this.maxConcurrent) throw new Error(`Task concurrency limit (${this.maxConcurrent}) reached`);
    if(!spec.title.trim() || !spec.executable || !spec.cwd) throw new Error('Task title, executable and cwd are required');
    if(spec.timeoutMs !== undefined && (!Number.isFinite(spec.timeoutMs)||spec.timeoutMs<0)) throw new Error('Invalid timeout');
    for(const old of this.list().filter(t=>!activeTask(t)).slice(0,Math.max(0,this.tasks.size-49))) {
      this.tasks.delete(old.id); this.owned.delete(old.id); try{unlinkSync(old.logPath);}catch{}
    }
    const id=randomUUID(); const logPath=join(this.options.logDir,`${id}.jsonl`);
    writeFileSync(logPath,'',{flag:'wx',mode:0o600});
    const task:TaskRecord={id,kind:spec.kind,title:cleanOutput(spec.title).slice(0,200),cwd:spec.cwd,command:spec.command,model:spec.model,status:'starting',startedAt:Date.now(),latest:'Starting',logPath,logs:[],dropped:0,diskTruncated:false};
    this.tasks.set(id,task);
    let resolve!:(task:TaskRecord)=>void; const done=new Promise<TaskRecord>(r=>{resolve=r;});
    let child:ChildProcess;
    const executable=process.platform==='win32'?(/^(node|bun)(\.exe)?$/i.test(basename(process.execPath))?process.execPath:'node'):spec.executable;
    const args=process.platform==='win32'?[fileURLToPath(new URL('./windows-supervisor.mjs',import.meta.url)),spec.executable,...spec.args]:spec.args;
    try { child=spawn(executable,args,{cwd:spec.cwd,env:spec.env ?? process.env,detached:process.platform!=='win32',windowsHide:true,stdio:['pipe','pipe','pipe']}); }
    catch(error:any) { task.status='failed';task.error=String(error.message);task.endedAt=Date.now();resolve(task); this.changed();queueMicrotask(()=>{for(const f of this.completions)f(task);});return task; }
    const owned:Owned={child,done,resolve,bytes:0,memory:0,seq:0,finished:false}; this.owned.set(id,owned); task.pid=child.pid;
    const finish=(code:number|null,signal:NodeJS.Signals|null) => {
      if(owned.finished) return; owned.finished=true;
      clearTimeout(owned.timeout);
      // Escalation stays armed after leader exit: descendants may ignore TERM.
      if(!owned.reason) clearTimeout(owned.escalation);
      let summary:{result?:string;error?:string}={};
      try{summary=spec.summarize?.() ?? {};}catch(error:any){summary.error=error.message;}
      task.result=summary.result?.slice(-24000);task.error=task.error || summary.error;
      task.status=owned.reason ?? (code===0&&!task.error?'completed':'failed');
      task.exitCode=code;task.endedAt=Date.now();
      if(signal&&!owned.reason&&!task.error) task.error=`Process exited on ${signal}`;
      this.append(task,'system',`${task.status}${code===null?'':` (exit ${code})`}${task.error?`: ${task.error}`:''}`);
      owned.resolve(task); this.changed();for(const f of this.completions){try{f(task);}catch{}}
    };
    child.once('spawn',()=>{if(!owned.reason)task.status='running';this.changed();});
    const receive=(stream:'stdout'|'stderr',text:string)=>{
      try {const entries=spec.transform?spec.transform(stream,text):[{stream,text}];for(const entry of entries)this.append(task,entry.stream,entry.text);}
      catch(error:any){task.error=`Output decode failed: ${error.message}`;this.append(task,'system',task.error);void this.stop(id).catch(()=>{});}
    };
    for(const stream of ['stdout','stderr'] as const){const decoder=new StringDecoder('utf8');child[stream]!.on('data',(chunk:Buffer)=>receive(stream,decoder.write(chunk)));child[stream]!.on('end',()=>{const tail=decoder.end();if(tail)receive(stream,tail);});}
    child.once('error',error=>{task.error=error.message;finish(null,null);});
    child.once('close',(code,signal)=>{
      if(process.platform!=='win32'&&!owned.reason){void signalTree(child,true).then(()=>finish(code,signal),error=>{task.error=error.message;finish(code,signal);});}
      else finish(code,signal);
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(spec.input);
    const timeout=spec.timeoutMs ?? 30*60*1000;
    if(timeout>0)owned.timeout=setTimeout(()=>{void this.stopWithReason(id,'timed_out').catch(error=>{task.error=error.message;this.changed();});},timeout);
    this.changed();return task;
  }
  private append(task:TaskRecord,stream:LogStream,text:string) {
    const owned=this.owned.get(task.id);if(!owned||!text)return;
    const clean=cleanOutput(text);
    // Bound single entries too, so a flood without newlines cannot pin memory.
    for(let i=0;i<clean.length;i+=1024){
      const entry:LogEntry={seq:++owned.seq,time:Date.now(),stream,text:clean.slice(i,i+1024)};
      task.logs.push(entry);owned.memory+=Buffer.byteLength(entry.text);
      while(owned.memory>this.maxMemoryBytes||task.logs.length>2000){const old=task.logs.shift()!;owned.memory-=Buffer.byteLength(old.text);task.dropped++;}
      task.latest=entry.text.trim().slice(-160)||task.latest;
      if(!task.diskTruncated){const line=JSON.stringify(entry)+'\n';const bytes=Buffer.byteLength(line);if(owned.bytes+bytes>this.maxLogBytes)task.diskTruncated=true;
        else try{appendFileSync(task.logPath,line);owned.bytes+=bytes;}catch(error:any){task.diskTruncated=true;task.error=`Log persistence failed: ${error.message}`;}}
    }
    this.changed();
  }
  async stop(id:string):Promise<TaskRecord> { return this.stopWithReason(id,'stopped'); }
  private async stopWithReason(id:string,reason:'stopped'|'timed_out'):Promise<TaskRecord>{
    const task=this.tasks.get(id);if(!task)throw new Error('Unknown task ID in this session');
    const owned=this.owned.get(id);if(!owned||!activeTask(task))return task;
    if(owned.stopPromise)return owned.stopPromise;
    owned.reason=reason;task.status='stopping';this.changed();
    owned.stopPromise=(async()=>{
      try{
        await signalTree(owned.child);
        if(process.platform!=='win32'){await new Promise<void>(resolve=>{owned.escalation=setTimeout(resolve,750);});await signalTree(owned.child,true);}
        let timer:NodeJS.Timeout|undefined;
        try{return await Promise.race([owned.done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Stop could not be confirmed; task may still be running')),5000);})]);}finally{clearTimeout(timer);}
      }catch(error:any){task.error=error.message;owned.stopPromise=undefined;this.changed();throw error;}
    })();
    return owned.stopPromise;
  }
  async dispose():Promise<void>{
    this.closed=true;
    const results=await Promise.allSettled(this.list().filter(t=>activeTask(t)||this.owned.get(t.id)?.stopPromise).map(t=>this.owned.get(t.id)?.stopPromise??this.stop(t.id)));
    this.listeners.clear();this.completions.clear();
    const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }
}
