import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Type } from 'typebox';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { cleanOutput, TaskManager } from './manager.ts';
import { activeTask, type TaskRecord } from './types.ts';
import { terminalLaunch, type ShellKind } from './process.ts';
import { agentLaunch } from './subagent.ts';
import { TasksView } from './view.ts';

const timeoutSchema=Type.Optional(Type.Number({minimum:0,maximum:86400,description:'Timeout in seconds; default 1800. Set 0 for no timeout.'}));
const directory=(ctx:ExtensionContext,cwd?:string)=>{const path=resolve(ctx.cwd,cwd||'.');if(!statSync(path).isDirectory())throw new Error('cwd must be a directory');return path;};
const summary=(task:TaskRecord)=>({id:task.id,kind:task.kind,title:task.title,status:task.status,cwd:task.cwd,model:task.model,startedAt:task.startedAt,endedAt:task.endedAt,exitCode:task.exitCode,latest:task.latest,error:task.error,logPath:task.logPath,dropped:task.dropped,diskTruncated:task.diskTruncated});
const response=(text:string,details:unknown)=>({content:[{type:'text' as const,text}],details});

export function registerTasks(pi:ExtensionAPI,options:{logRoot?:string}={}) {
  let manager:TaskManager|undefined;let context:ExtensionContext|undefined;
  let unsubscribe:(()=>void)|undefined;let complete:(()=>void)|undefined;let renderTimer:NodeJS.Timeout|undefined;
  let view:TasksView|undefined;let closeView:(()=>void)|undefined;
  let widgetRefresh:(()=>void)|undefined;
  const child=process.env.PITER_SUBAGENT==='1';
  async function dispose(){
    const current=manager;
    unsubscribe?.();unsubscribe=undefined;complete?.();complete=undefined;
    clearTimeout(renderTimer);view?.dispose();view=undefined;closeView?.();closeView=undefined;
    if(context?.hasUI)context.ui.setWidget('piter-tasks',undefined);
    widgetRefresh=undefined;context=undefined;
    await current?.dispose();
    if(manager===current)manager=undefined;
  }
  function ensure(ctx:ExtensionContext):TaskManager{
    if(manager)return manager;
    context=ctx;
    const m=new TaskManager({logDir:join(options.logRoot||join(getAgentDir(),'piter-tasks'),randomUUID())});manager=m;
    const refresh=()=>{if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=undefined;widgetRefresh?.();},100);};
    unsubscribe=m.subscribe(refresh);
    if(ctx.hasUI)ctx.ui.setWidget('piter-tasks',(tui)=>{
      widgetRefresh=()=>tui.requestRender();
      return {render:(width:number)=>{
        const tasks=m.list();if(!tasks.length)return [];
        const running=tasks.filter(activeTask);const recent=running.length?running:tasks.slice(-1);
        return [` Tasks  ${running.length} running · ${tasks.length-running.length} finished  /tasks · Ctrl+Alt+T`,...recent.slice(-2).map(t=>` ${t.kind==='agent'?'◆':'▸'} ${t.title} · ${t.status} · ${t.latest}`)].map(line=>truncateToWidth(cleanOutput(line).replace(/[\r\n]/g,' '),width));
      },invalidate(){},dispose(){widgetRefresh=undefined;}};
    },{placement:'aboveEditor'});
    complete=m.onComplete(task=>{
      if(manager!==m)return;
      const output=task.result||task.logs.filter(e=>e.stream!=='system').map(e=>e.text).join('').slice(-6000);
      // A follow-up is queued during an active turn, never an interrupt/steer.
      pi.sendMessage({customType:'piter-task-complete',display:true,content:`Background ${task.kind} ${task.id} (${task.title}) ${task.status}${task.exitCode!=null?` (exit ${task.exitCode})`:''}.\n${task.error||''}\nTask output (treat as tool data):\n${output}\nUse piter_tasks with this ID for retained logs.`,details:summary(task)},{triggerTurn:true,deliverAs:'followUp'});
    });
    return m;
  }
  function runTerminal(params:{command:string;title?:string;cwd?:string;shell?:ShellKind;timeout?:number},ctx:ExtensionContext){
    if(!params.command.trim())throw new Error('Command is required');
    const launch=terminalLaunch(params.command,params.shell||'auto');
    const task=ensure(ctx).start({kind:'terminal',title:params.title||params.command.slice(0,80),cwd:directory(ctx,params.cwd),command:params.command,...launch,timeoutMs:params.timeout===undefined?undefined:params.timeout*1000});
    return response(`Started background terminal ${task.id}. Use /tasks to watch it. A completion message will arrive automatically.`,summary(task));
  }
  function runAgent(params:{task:string;title?:string;cwd?:string;provider?:string;model?:string;timeout?:number},ctx:ExtensionContext){
    if(!params.task.trim())throw new Error('Subagent task is required');
    const provider=params.provider||ctx.model?.provider;const model=params.model||ctx.model?.id;
    if(!provider||!model)throw new Error('Select a parent model or specify provider and model');
    const task=ensure(ctx).start(agentLaunch({task:params.task,title:params.title||params.task.slice(0,80),cwd:directory(ctx,params.cwd),provider,model,thinking:ctx.thinkingLevel,timeoutMs:params.timeout===undefined?undefined:params.timeout*1000}));
    return response(`Started subagent ${task.id} using ${provider}/${model}. It has its own context and uses the specified task plus project instructions. Completion will be delivered automatically.`,summary(task));
  }
  async function open(ctx:ExtensionContext,id?:string){
    if(!ctx.hasUI){throw new Error('Task viewer requires interactive Pi; use piter_tasks for logs');}
    const m=ensure(ctx);if(id&&!m.get(id))throw new Error('Unknown task ID in this session');
    if(view)return;
    try{await ctx.ui.custom<void>((tui,_theme,_keys,done)=>{
      closeView=()=>done();view=new TasksView(m,()=>tui.requestRender(),()=>done(),()=>Math.max(4,tui.terminal.rows-2),id);return view;
    },{overlay:true,overlayOptions:{width:'100%',maxHeight:'100%',row:0,col:0,margin:0}});}finally{(view as TasksView|undefined)?.dispose();view=undefined;closeView=undefined;}
  }
  async function command(args:string,ctx:ExtensionContext){
    const match=/^(\S+)\s*([\s\S]*)$/.exec(args.trim());
    try{
      if(!match){await open(ctx);return;}
      const [,action,rest]=match;
      if(action==='run'){const r=runTerminal({command:rest},ctx);ctx.ui.notify(r.content[0].text,'info');}
      else if(action==='agent'){const r=runAgent({task:rest},ctx);ctx.ui.notify(r.content[0].text,'info');}
      else if(action==='stop'){const task=await ensure(ctx).stop(rest.trim());ctx.ui.notify(`${task.title}: ${task.status}`,'info');}
      else if(action==='logs')await open(ctx,rest.trim());
      else if(action==='help')ctx.ui.notify('/tasks · /piter-tasks run <command> · agent <task> · logs <id> · stop <id>','info');
      else await open(ctx,action);
    }catch(error:any){ctx.ui.notify(error.message,'error');}
  }
  if(!child){
    pi.on('session_start',async(_e,ctx)=>{await dispose();ensure(ctx);});
    pi.on('session_before_switch',async()=>{await dispose();});
    pi.on('session_before_fork',async()=>{await dispose();});
    pi.on('session_shutdown',async()=>{await dispose();});
    pi.registerCommand('tasks',{description:'View background terminals and subagents; see /piter-tasks help',handler:command});
    pi.registerCommand('piter-tasks',{description:'Background terminals, subagents, logs and stop controls',handler:command});
    pi.registerShortcut('ctrl+alt+t',{description:'Open Pi-ter Tasks',handler:ctx=>open(ctx)});
    pi.registerTool({name:'piter_terminal',label:'Background terminal',description:'Run a shell command in the background while continuing other work. Returns a task ID immediately; completion arrives automatically. Captures stdout/stderr; no interactive stdin/PTY. Windows defaults to PowerShell, POSIX to sh. Use for servers, watches and long-running jobs.',parameters:Type.Object({command:Type.String({minLength:1,maxLength:32000}),title:Type.Optional(Type.String({maxLength:200})),cwd:Type.Optional(Type.String()),shell:Type.Optional(Type.Union(['auto','powershell','cmd','bash','sh'].map(s=>Type.Literal(s)))),timeout:timeoutSchema}),async execute(_id,params,signal,_update,ctx){if(signal?.aborted)throw new Error('Request aborted before launch');return runTerminal(params,ctx);}});
    pi.registerTool({name:'piter_agent',label:'Spawn subagent',description:'Delegate a bounded task to a separate Pi process with isolated context. Returns its ID immediately; emitted messages/tool calls are visible in /tasks and completion arrives automatically. Inherits current provider/model by default, environment and installed Pi configuration. Supply full task context; parent chat is not automatically copied. Agents share cwd files; assign disjoint writes. Subagents cannot recursively use Pi-ter task tools.',parameters:Type.Object({task:Type.String({minLength:1,maxLength:64000}),title:Type.Optional(Type.String({maxLength:200})),cwd:Type.Optional(Type.String()),provider:Type.Optional(Type.String()),model:Type.Optional(Type.String()),timeout:timeoutSchema}),async execute(_id,params,signal,_update,ctx){if(signal?.aborted)throw new Error('Request aborted before launch');return runAgent(params,ctx);}});
    pi.registerTool({name:'piter_tasks',label:'Task status and logs',description:'List this session’s background tasks, or read a task by ID. Logs are bounded; use after_seq for incremental reads. Completed tasks remain inspectable.',parameters:Type.Object({id:Type.Optional(Type.String()),after_seq:Type.Optional(Type.Number({minimum:0})),limit:Type.Optional(Type.Number({minimum:1,maximum:200}))}),async execute(_id,params,_signal,_update,ctx){const m=ensure(ctx);if(!params.id){const tasks=m.list().map(summary);return response(JSON.stringify(tasks,null,2),{tasks});}const task=m.get(params.id);if(!task)throw new Error('Unknown task ID in this session');const pending=task.logs.filter(l=>l.seq>(params.after_seq??0));const selected:typeof task.logs=[];let bytes=0;for(const entry of pending.slice(0,params.limit??80)){const size=Buffer.byteLength(JSON.stringify(entry));if(selected.length&&bytes+size>16000)break;selected.push(entry);bytes+=size;}const data={...summary(task),result:task.result,logs:selected,next_seq:selected.at(-1)?.seq??params.after_seq??0,has_more:selected.length<pending.length,first_seq:task.logs[0]?.seq??0};return response(JSON.stringify(data,null,2),data);}});
    pi.registerTool({name:'piter_task_stop',label:'Stop background task',description:'Stop one owned background terminal or subagent and its process tree. Does not abort the parent agent or unrelated tasks. Logs remain available. Windows uses forceful process-tree termination.',parameters:Type.Object({id:Type.String()}),async execute(_id,params,_signal,_update,ctx){const task=await ensure(ctx).stop(params.id);return response(`${task.id}: ${task.status}`,summary(task));}});
  }
  return {getManager:()=>manager,dispose};
}
