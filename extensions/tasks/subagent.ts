import { existsSync } from 'node:fs';
import { getPackageDir } from '@earendil-works/pi-coding-agent';
import { join, basename } from 'node:path';
import type { LaunchSpec } from './manager.ts';
import type { LogStream } from './types.ts';
type Entry = { stream: LogStream; text: string };
const contentText = (content: any): string => Array.isArray(content) ? content.filter(p=>p?.type==='text').map(p=>p.text||'').join('\n') : typeof content==='string'?content:'';

/** Decode Pi's public JSON event stream; thinking content is intentionally not displayed. */
export class AgentOutput {
  private buffer=''; private overflow=false; private error?:string; private result=''; private streamed=false;
  private toolText=new Map<string,string>();
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
    if(e.type==='message_start'){this.streamed=false;return [];}
    if(e.type==='message_update' && e.assistantMessageEvent?.type==='text_delta'){
      this.streamed=true;return [{stream:'agent',text:String(e.assistantMessageEvent.delta||'')}];
    }
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
      const text=contentText(e.message.content);if(text)this.result=text.slice(-24000);
      if(e.message.stopReason==='error'||e.message.stopReason==='aborted')this.error=e.message.errorMessage||`Subagent ${e.message.stopReason}`;
      return [...(!this.streamed&&text?[{stream:'agent' as const,text}]:[]),...(this.error?[{stream:'system' as const,text:this.error}]:[])];
    }
    if(e.type==='error'){this.error=String(e.message||e.error||'Subagent error');return [{stream:'system',text:this.error}];}
    return [];
  }
  summary():{result?:string;error?:string}{
    if(this.buffer.trim()){this.decode(this.buffer);this.buffer='';}
    return {result:this.result||undefined,error:this.error||(!this.result?'Subagent exited without an assistant result; inspect stderr and provider configuration.':undefined)};
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
export function agentLaunch(options:{task:string;title:string;cwd:string;provider:string;model:string;thinking?:string;timeoutMs?:number;access?:AgentAccess;tools?:string[];excludeTools?:string[]}):LaunchSpec{
  const limits=toolArgs(options);const parser=new AgentOutput();const invocation=piInvocation();
  return {
    kind:'agent',title:options.title,cwd:options.cwd,command:'Pi subagent',model:`${options.provider}/${options.model}`,
    executable:invocation.executable,args:[...invocation.args,'--mode','json','--print','--no-session','--provider',options.provider,'--model',options.model,...(options.thinking?['--thinking',options.thinking]:[]),...limits],
    input:options.task,env:{...process.env,PITER_SUBAGENT:'1',PI_SPLASH:'0'},timeoutMs:options.timeoutMs,
    transform:(stream,text)=>parser.consume(stream,text),summarize:()=>parser.summary(),
  };
}
