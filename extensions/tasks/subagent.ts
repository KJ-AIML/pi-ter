import { existsSync, readdirSync, statSync } from 'node:fs';
import { getPackageDir } from '@earendil-works/pi-coding-agent';
import { join, basename } from 'node:path';
import type { LaunchSpec } from './manager.ts';
import type { AgentMessageMode, LogStream, TaskProgress, TaskUsage } from './types.ts';
type Entry = { stream: LogStream; text: string };
const contentText = (content: any): string => Array.isArray(content) ? content.filter(p=>p?.type==='text').map(p=>p.text||'').join('\n') : typeof content==='string'?content:'';

/**
 * Client end of Pi's RPC protocol for one child: sends the task as the first prompt, forwards
 * steering/follow-up messages, and closes stdin (an orderly shutdown) once the child has settled.
 */
export class RpcLink {
  private write?: (text: string) => void; private end?: () => void;
  private seq = 0; closed = false;
  private task: string;
  constructor(task: string) { this.task = task; }
  attach(write: (text: string) => void, end: () => void) { this.write = write; this.end = end; this.record({ id: 'start', type: 'prompt', message: this.task }); }
  record(value: Record<string, unknown>) { if (this.closed || !this.write) throw new Error('Subagent input is closed'); this.write(JSON.stringify(value) + '\n'); }
  send(mode: AgentMessageMode, message: string) {
    if (!message.trim()) throw new Error('Message is required');
    this.record({ id: `msg-${++this.seq}`, type: mode === 'steer' ? 'steer' : 'follow_up', message });
  }
  finish() { if (this.closed) return; this.closed = true; this.end?.(); }
}
const DIALOGS = new Set(['select', 'confirm', 'input', 'editor']);

/** Decode Pi's public JSON event stream; thinking content is intentionally not displayed. */
export class AgentOutput {
  private link?: RpcLink;
  constructor(link?: RpcLink) { this.link = link; }
  private buffer=''; private overflow=false; private error?:string; private result=''; private streamed=false;
  private toolText=new Map<string,string>();
  private usage:TaskUsage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:0,turns:0};
  /** Usage of the assistant message currently streaming; folded into usage at message_end. */
  private current:{tokens:number;cost:number}={tokens:0,cost:0};
  private turnsStarted=0;private toolsStarted=0;
  /** Live counters, including the message that is still streaming. */
  progress():TaskProgress{
    return {turns:this.turnsStarted,tools:this.toolsStarted,tokens:this.usage.totalTokens+this.current.tokens,cost:this.usage.cost+this.current.cost};
  }
  private addUsage(u:any){
    const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
    this.usage.turns++;if(!u||typeof u!=='object')return;
    this.usage.input+=n(u.input);this.usage.output+=n(u.output);this.usage.cacheRead+=n(u.cacheRead);this.usage.cacheWrite+=n(u.cacheWrite);
    this.usage.totalTokens+=n(u.totalTokens);this.usage.cost+=n(u.cost?.total);
  }
  consume(stream:'stdout'|'stderr',text:string):Entry[]{
    if(stream==='stderr') return [{stream,text}];
    const out:Entry[]=[];
    for(const piece of text.split(/(?<=\n)/)){
      if(this.overflow){if(piece.endsWith('\n'))this.overflow=false;continue;}
      this.buffer+=piece;
      if(this.buffer.length>1024*1024){this.buffer='';this.overflow=!piece.endsWith('\n');this.error='Subagent JSON line exceeded 1 MiB';out.push({stream:'system',text:this.error});continue;}
      if(this.buffer.endsWith('\n')){out.push(...this.decode(this.buffer));this.buffer='';}
    }
    return out;
  }
  private decode(line:string):Entry[]{
    if(!line.trim())return [];
    let e:any;try{e=JSON.parse(line);}catch{return [{stream:'stdout',text:line.slice(0,4096)}];}
    if(e.type==='response'&&this.link){
      if(e.success===false){
        const message=`${e.command||'command'} rejected: ${e.error||'unknown error'}`;
        if(e.id==='start'){this.error=message;this.link.finish();}
        return [{stream:'system',text:message}];
      }
      // A prompt consumed by an extension command starts no run, so nothing will settle.
      if(e.id==='start'&&e.data?.disposition==='handled')this.link.finish();
      return [];
    }
    if(e.type==='extension_ui_request'&&this.link){
      // Nobody can answer a child's dialog; cancel it so the child never blocks.
      if(DIALOGS.has(e.method)){try{this.link.record({type:'extension_ui_response',id:e.id,cancelled:true});}catch{}return [{stream:'system',text:`Cancelled extension dialog: ${String(e.title||e.method).slice(0,200)}`}];}
      return [];
    }
    if(e.type==='agent_settled'&&this.link){this.link.finish();return [];}
    if(e.type==='message_start'){this.streamed=false;if(e.message?.role==='assistant'){this.turnsStarted++;this.current={tokens:0,cost:0};}return [];}
    if(e.type==='message_update'&&e.usage&&typeof e.usage==='object'){
      const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
      this.current={tokens:n(e.usage.totalTokens),cost:n(e.usage.cost?.total)};
    }
    if(e.type==='message_update' && e.assistantMessageEvent?.type==='text_delta'){
      this.streamed=true;return [{stream:'agent',text:String(e.assistantMessageEvent.delta||'')}];
    }
    if(e.type==='tool_execution_start'){this.toolsStarted++;}
    if(e.type==='tool_execution_start')return [{stream:'tool',text:`\n▶ ${e.toolName} ${JSON.stringify(e.args??{}).slice(0,4000)}\n`}];
    if(e.type==='tool_execution_update'){
      const text=contentText(e.partialResult?.content);const key=String(e.toolCallId);const previous=this.toolText.get(key)||'';
      const delta=text.startsWith(previous)?text.slice(previous.length):text;
      this.toolText.set(key,text.slice(-64000));
      if(this.toolText.size>32)this.toolText.delete(this.toolText.keys().next().value!);
      return delta?[{stream:'tool',text:delta}]:[];
    }
    if(e.type==='tool_execution_end'){
      const key=String(e.toolCallId);const text=contentText(e.result?.content);const previous=this.toolText.get(key)||'';this.toolText.delete(key);
      return [{stream:'tool',text:`${text.startsWith(previous)?text.slice(previous.length):text}\n${e.isError?'✗':'✓'} ${e.toolName}\n`}];
    }
    if(e.type==='message_end'&&e.message?.role==='assistant'){
      this.addUsage(e.message.usage);this.current={tokens:0,cost:0};
      // A provider may skip message_start on the wire; never report fewer turns than finished ones.
      this.turnsStarted=Math.max(this.turnsStarted,this.usage.turns);
      const text=contentText(e.message.content);if(text)this.result=text.slice(-24000);
      if(e.message.stopReason==='error'||e.message.stopReason==='aborted')this.error=e.message.errorMessage||`Subagent ${e.message.stopReason}`;
      return [...(!this.streamed&&text?[{stream:'agent' as const,text}]:[]),...(this.error?[{stream:'system' as const,text:this.error}]:[])];
    }
    if(e.type==='error'){this.error=String(e.message||e.error||'Subagent error');return [{stream:'system',text:this.error}];}
    return [];
  }
  summary():{result?:string;error?:string;usage?:TaskUsage}{
    if(this.buffer.trim()){this.decode(this.buffer);this.buffer='';}
    return {usage:this.usage.turns?{...this.usage}:undefined,result:this.result||undefined,error:this.error||(!this.result?'Subagent exited without an assistant result; inspect stderr and provider configuration.':undefined)};
  }
}

export function piInvocation():{executable:string;args:string[]}{
  // Resolve the installed CLI rather than relying on a Windows npm .cmd shim.
  for(const relative of ['dist/bundle/cli.js','dist/cli.js']) {
    const cli=join(getPackageDir(),relative);if(existsSync(cli))return {executable:process.execPath,args:[cli]};
  }
  const exe=basename(process.execPath).toLowerCase();
  if(!/^(node|bun)(\.exe)?$/.test(exe))return {executable:process.execPath,args:[]};
  throw new Error('Cannot locate Pi CLI entry point for subagent');
}
export type AgentAccess='full'|'read-only';
/** Read-only children get file-inspection tools only; bash, editors and MCP gateways are denied by Pi itself. */
export const READ_ONLY_TOOLS=['read','grep','find','ls'];
export const READ_ONLY_DENY=['bash','edit','write','mcp','mcp__*'];
const toolName=/^[A-Za-z0-9_.:*-]{1,100}$/;
function toolList(label:string,names:string[]|undefined):string[]{
  const list=[...new Set((names??[]).map(n=>n.trim()).filter(Boolean))];
  for(const name of list)if(!toolName.test(name))throw new Error(`Invalid ${label} entry: ${JSON.stringify(name)}`);
  return list;
}
/** Translate access/tool options into Pi CLI flags; deny always wins over allow in Pi. */
export function toolArgs(options:{access?:AgentAccess;tools?:string[];excludeTools?:string[]}):string[]{
  const access=options.access??'full';if(access!=='full'&&access!=='read-only')throw new Error(`Unknown access mode: ${access}`);
  const allow=toolList('tools',options.tools);const deny=toolList('excludeTools',options.excludeTools);
  const readOnly=access==='read-only';
  const tools=allow.length?allow:readOnly?READ_ONLY_TOOLS:[];
  const exclude=[...new Set([...deny,...(readOnly?READ_ONLY_DENY:[])])];
  return [...(tools.length?['--tools',tools.join(',')]:[]),...(exclude.length?['--exclude-tools',exclude.join(',')]:[])];
}
export const THINKING_LEVELS=['off','minimal','low','medium','high','xhigh','max'] as const;
export type AgentRole='scout'|'reviewer'|'worker';
/** Role presets are defaults only; explicit access/thinking/instructions from the caller win. */
export const ROLES:Record<AgentRole,{access:AgentAccess;thinking?:string;prompt:string}>={
  scout:{access:'read-only',thinking:'low',prompt:'You are a fast reconnaissance subagent. Inspect only what the task needs and do not modify anything. Return compressed, evidence-backed findings with file paths and line references, then list open questions.'},
  reviewer:{access:'read-only',thinking:'high',prompt:'You are a code reviewer subagent. Do not modify anything. Verify claims against the code, report findings ordered by severity with file:line evidence, and separate confirmed defects from suspicions.'},
  worker:{access:'full',prompt:'You are an implementation subagent. Make the smallest change that completes the task, stay inside the stated scope, run the relevant checks, and finish with the files changed, verification results and residual risks.'},
};
export const MAX_INSTRUCTIONS=8000;
export type AgentLaunchOptions={task:string;title:string;cwd:string;provider:string;model:string;thinking?:string;timeoutMs?:number;access?:AgentAccess;tools?:string[];excludeTools?:string[];role?:AgentRole;instructions?:string;parentThinking?:string;
  /** Private folder for the child's saved session (enables continuing it later). */
  sessionDir:string;
  /** Session file to resume instead of starting a new conversation. */
  sessionFile?:string};
/** Newest saved session in a subagent's private session folder. */
export function latestSession(dir:string):string|undefined{
  let best:{path:string;time:number}|undefined;
  try{for(const name of readdirSync(dir)){if(!name.endsWith('.jsonl'))continue;const path=join(dir,name);const time=statSync(path).mtimeMs;if(!best||time>best.time)best={path,time};}}catch{return undefined;}
  return best?.path;
}
export function agentLaunch(options:AgentLaunchOptions):LaunchSpec{
  const role=options.role?ROLES[options.role]:undefined;if(options.role&&!role)throw new Error(`Unknown role: ${options.role}`);
  const thinking=options.thinking??role?.thinking??options.parentThinking;
  if(thinking&&!(THINKING_LEVELS as readonly string[]).includes(thinking))throw new Error(`Unknown thinking level: ${thinking}`);
  const extra=options.instructions?.trim()??'';if(extra.length>MAX_INSTRUCTIONS)throw new Error(`instructions exceed ${MAX_INSTRUCTIONS} characters`);
  if(!options.sessionDir)throw new Error('sessionDir is required');
  // The heading keeps the value multi-line so Pi never mistakes it for a file path.
  const prompt=[role&&`## Subagent role: ${options.role}\n${role.prompt}`,extra&&`## Subagent instructions\n${extra}`].filter(Boolean).join('\n\n');
  const limits=toolArgs({...options,access:options.access??role?.access});
  const link=new RpcLink(options.task);const parser=new AgentOutput(link);const invocation=piInvocation();
  const {task:_task,timeoutMs:_timeout,sessionFile:_file,sessionDir,parentThinking:_parent,...kept}=options;
  return {
    kind:'agent',title:options.title,cwd:options.cwd,command:'Pi subagent',model:`${options.provider}/${options.model}`,
    executable:invocation.executable,args:[...invocation.args,'--mode','rpc','--session-dir',sessionDir,...(options.sessionFile?['--session',options.sessionFile]:[]),'--provider',options.provider,'--model',options.model,...(thinking?['--thinking',thinking]:[]),...limits,...(prompt?['--append-system-prompt',prompt]:[])],
    input:options.task,env:{...process.env,PITER_SUBAGENT:'1',PI_SPLASH:'0'},timeoutMs:options.timeoutMs,
    transform:(stream,text)=>parser.consume(stream,text),summarize:()=>parser.summary(),progress:()=>parser.progress(),
    interactive:{attach:(write,end)=>link.attach(write,end),send:(mode,message)=>link.send(mode,message)},
    // Resolved thinking is stored so a continued run keeps the same level.
    agent:{sessionDir,options:{...kept,...(thinking?{thinking}:{})}},
  };
}
