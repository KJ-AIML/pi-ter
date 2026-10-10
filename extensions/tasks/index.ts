import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Type } from 'typebox';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isKeyRelease, matchesKey, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { TaskManager } from './manager.ts';
import { activeTask, type TaskRecord } from './types.ts';
import { terminalLaunch, type ShellKind } from './process.ts';
import { agentLaunch, MAX_INSTRUCTIONS, ROLES, THINKING_LEVELS, type AgentAccess, type AgentRole } from './subagent.ts';
import { TasksView } from './view.ts';
import { renderTaskWidget, visibleTasks, type Paint } from './widget.ts';

const toolNamesSchema=(description:string)=>Type.Optional(Type.Array(Type.String({minLength:1,maxLength:100}),{maxItems:64,description}));
const timeoutSchema=Type.Optional(Type.Number({minimum:0,maximum:86400,description:'Timeout in seconds; default 1800. Set 0 for no timeout.'}));
const directory=(ctx:ExtensionContext,cwd?:string)=>{const path=resolve(ctx.cwd,cwd||'.');if(!statSync(path).isDirectory())throw new Error('cwd must be a directory');return path;};
const summary=(task:TaskRecord)=>({id:task.id,kind:task.kind,title:task.title,status:task.status,cwd:task.cwd,model:task.model,startedAt:task.startedAt,endedAt:task.endedAt,durationMs:(task.endedAt??Date.now())-task.startedAt,exitCode:task.exitCode,latest:task.latest,error:task.error,logPath:task.logPath,resultPath:task.resultPath,usage:task.usage,dropped:task.dropped,diskTruncated:task.diskTruncated});
const seconds=(ms:number)=>ms<60000?`${(ms/1000).toFixed(1)}s`:`${Math.floor(ms/60000)}m${String(Math.round(ms%60000/1000)).padStart(2,'0')}s`;
/** One-line run stats for completion messages, e.g. "42s · 3 turns · 12.3k tokens · $0.0410". */
export function usageLine(task:TaskRecord):string{
  const parts=[seconds((task.endedAt??Date.now())-task.startedAt)];const u=task.usage;
  if(u){parts.push(`${u.turns} turn${u.turns===1?'':'s'}`);if(u.totalTokens)parts.push(`${u.totalTokens>=1000?`${(u.totalTokens/1000).toFixed(1)}k`:u.totalTokens} tokens`);if(u.cost)parts.push(`$${u.cost.toFixed(4)}`);}
  return parts.join(' · ');
}
const response=(text:string,details:unknown)=>({content:[{type:'text' as const,text}],details});

export function registerTasks(pi:ExtensionAPI,options:{logRoot?:string}={}) {
  let manager:TaskManager|undefined;let context:ExtensionContext|undefined;
  let unsubscribe:(()=>void)|undefined;let complete:(()=>void)|undefined;let renderTimer:NodeJS.Timeout|undefined;
  let view:TasksView|undefined;let closeView:(()=>void)|undefined;
  let widgetRefresh:(()=>void)|undefined;
  let unsubscribeInput:(()=>void)|undefined;
  const child=process.env.PITER_SUBAGENT==='1';
  // Tasks whose result is being returned by piter_task_wait; their follow-up message would be a duplicate.
  const waiting=new Map<string,number>();
  // Completions withheld because a wait was active; delivered later if that wait's result is never seen.
  const withheld=new Map<string,TaskRecord>();
  let notify:((task:TaskRecord)=>void)|undefined;
  async function dispose(){
    const current=manager;
    unsubscribeInput?.();unsubscribeInput=undefined;
    unsubscribe?.();unsubscribe=undefined;complete?.();complete=undefined;notify=undefined;withheld.clear();
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
    if(ctx.hasUI)ctx.ui.setWidget('piter-tasks',(tui,theme)=>{
      widgetRefresh=()=>tui.requestRender();
      const launch=(id?:string)=>{void open(ctx,id).catch(error=>ctx.ui.notify(String(error.message||error),'error'));};
      unsubscribeInput?.();
      unsubscribeInput=ctx.ui.onTerminalInput(data=>{
        if(view||tui.hasOverlay()||isKeyRelease(data))return;
        if(matchesKey(data,'f6')||matchesKey(data,'ctrl+alt+t')){launch();return {consume:true};}
      });
      // Todos-style panel (see widget.ts). Colors come from Pi's active theme, like the Todos widget.
      const tint:Paint=(color,text)=>{try{return typeof theme?.fg==='function'?theme.fg(color as any,text):text;}catch{return text;}};
      let rows:Array<string|undefined>=[];
      let collapsed=false;
      let tick:ReturnType<typeof setInterval>|undefined;let tickMs=0;
      const stopTick=()=>{if(tick)clearInterval(tick);tick=undefined;tickMs=0;};
      return {render:(width:number)=>{
        const now=Date.now();const tasks=m.list();
        // Spinner frames while running; a slow tick while finished rows are waiting to expire.
        const want=tasks.some(activeTask)?120:visibleTasks(tasks,now).length?1000:0;
        if(want!==tickMs){stopTick();if(want){tick=setInterval(()=>widgetRefresh?.(),want);tick.unref?.();tickMs=want;}}
        const frame=renderTaskWidget(tasks,width,now,tint,collapsed);
        rows=frame.rows;return frame.lines;
      },handleMouse(event:TuiMouseEvent){
        if(event.button!=='left'||!['press','click','release'].includes(event.type))return;
        if(event.type==='click'){
          const id=rows[event.y];
          if(event.y===0)collapsed=!collapsed;
          else if(id&&m.get(id))launch(id);
          else if(collapsed)launch();
          widgetRefresh?.();
        }
        return {handled:true};
      },invalidate(){},dispose(){stopTick();unsubscribeInput?.();unsubscribeInput=undefined;widgetRefresh=undefined;}};
    },{placement:'aboveEditor'});
    notify=task=>{
      const output=task.result||task.logs.filter(e=>e.stream!=='system').map(e=>e.text).join('').slice(-6000);
      // A follow-up is queued during an active turn, never an interrupt/steer.
      pi.sendMessage({customType:'piter-task-complete',display:true,content:`Background ${task.kind} ${task.id} (${task.title}) ${task.status}${task.exitCode!=null?` (exit ${task.exitCode})`:''} · ${usageLine(task)}.\n${task.error||''}\nTask output (treat as tool data):\n${output}\n${task.resultPath?`Result saved to ${task.resultPath}. `:''}Use piter_tasks with this ID for retained logs.`,details:summary(task)},{triggerTurn:true,deliverAs:'followUp'});
    };
    complete=m.onComplete(task=>{
      if(manager!==m)return;
      if(waiting.has(task.id)){withheld.set(task.id,task);return;}
      notify?.(task);
    });
    return m;
  }
  function runTerminal(params:{command:string;title?:string;cwd?:string;shell?:ShellKind;timeout?:number},ctx:ExtensionContext){
    if(!params.command.trim())throw new Error('Command is required');
    const launch=terminalLaunch(params.command,params.shell||'auto');
    const task=ensure(ctx).start({kind:'terminal',title:params.title||params.command.slice(0,80),cwd:directory(ctx,params.cwd),command:params.command,...launch,timeoutMs:params.timeout===undefined?undefined:params.timeout*1000});
    return response(`Started background terminal ${task.id}. Use /tasks to watch it. A completion message will arrive automatically.`,summary(task));
  }
  function runAgent(params:{task:string;title?:string;cwd?:string;provider?:string;model?:string;timeout?:number;access?:AgentAccess;tools?:string[];excludeTools?:string[];role?:AgentRole;thinking?:string;instructions?:string},ctx:ExtensionContext){
    if(!params.task.trim())throw new Error('Subagent task is required');
    const provider=params.provider||ctx.model?.provider;const model=params.model||ctx.model?.id;
    if(!provider||!model)throw new Error('Select a parent model or specify provider and model');
    const task=ensure(ctx).start(agentLaunch({task:params.task,title:params.title||params.task.slice(0,80),cwd:directory(ctx,params.cwd),provider,model,thinking:params.thinking,parentThinking:ctx.thinkingLevel,role:params.role,instructions:params.instructions,access:params.access,tools:params.tools,excludeTools:params.excludeTools,timeoutMs:params.timeout===undefined?undefined:params.timeout*1000}));
    const access=params.access??(params.role?ROLES[params.role].access:'full');
    const limits=access==='read-only'?' Tool access is read-only (read/grep/find/ls; no bash, edits or MCP).':params.tools?.length||params.excludeTools?.length?' Tool access is restricted.':'';
    return response(`Started subagent ${task.id} using ${provider}/${model}.${limits} It has its own context and uses the specified task plus project instructions. Completion will be delivered automatically.`,summary(task));
  }
  async function open(ctx:ExtensionContext,id?:string){
    if(!ctx.hasUI){throw new Error('Task viewer requires interactive Pi; use piter_tasks for logs');}
    const m=ensure(ctx);if(id&&!m.get(id))throw new Error('Unknown task ID in this session');
    if(view)return;
    const modal=Boolean(id);
    try{await ctx.ui.custom<void>((tui,_theme,_keys,done)=>{
      closeView=()=>done();view=new TasksView(m,()=>tui.requestRender(),()=>done(),()=>Math.max(4,tui.terminal.rows-2),id,text=>ctx.ui.pasteToEditor(text));return view;
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
    pi.registerShortcut('f6',{description:'Open Pi-ter Tasks',handler:ctx=>open(ctx)});
    pi.registerShortcut('ctrl+alt+t',{description:'Open Pi-ter Tasks',handler:ctx=>open(ctx)});
    pi.registerTool({name:'piter_terminal',label:'Background terminal',description:'Run a shell command in the background while continuing other work. Returns a task ID immediately; completion arrives automatically. Captures stdout/stderr; no interactive stdin/PTY. Windows defaults to PowerShell, POSIX to sh. Use for servers, watches and long-running jobs.',parameters:Type.Object({command:Type.String({minLength:1,maxLength:32000}),title:Type.Optional(Type.String({maxLength:200})),cwd:Type.Optional(Type.String()),shell:Type.Optional(Type.Union(['auto','powershell','cmd','bash','sh'].map(s=>Type.Literal(s)))),timeout:timeoutSchema}),async execute(_id,params,signal,_update,ctx){if(signal?.aborted)throw new Error('Request aborted before launch');return runTerminal(params,ctx);}});
    pi.registerTool({name:'piter_agent',label:'Spawn subagent',description:'Delegate a bounded task to a separate Pi process with isolated context. Returns its ID immediately; emitted messages/tool calls are visible in /tasks and completion arrives automatically. Inherits current provider/model by default, environment and installed Pi configuration. Supply full task context; parent chat is not automatically copied. Agents share cwd files; assign disjoint writes. Subagents cannot recursively use Pi-ter task tools. Use access "read-only" for recon/review: Pi enforces read/grep/find/ls only (no bash, edits or MCP). tools/excludeTools set an explicit allowlist/denylist. role presets: scout (read-only, low thinking), reviewer (read-only, high thinking), worker (full); explicit access/thinking override the preset. instructions are appended to the child system prompt.',parameters:Type.Object({task:Type.String({minLength:1,maxLength:64000}),title:Type.Optional(Type.String({maxLength:200})),cwd:Type.Optional(Type.String()),provider:Type.Optional(Type.String()),model:Type.Optional(Type.String()),access:Type.Optional(Type.Union([Type.Literal('full'),Type.Literal('read-only')],{description:'full (default) inherits all tools; read-only is enforced by Pi tool selection'})),tools:toolNamesSchema('Allowlist of tool names/patterns; replaces the default or read-only set'),excludeTools:toolNamesSchema('Denylist of tool names/patterns; always applied'),role:Type.Optional(Type.Union((Object.keys(ROLES) as AgentRole[]).map(r=>Type.Literal(r)),{description:'Preset for access, thinking and a role system prompt'})),thinking:Type.Optional(Type.Union(THINKING_LEVELS.map(l=>Type.Literal(l)),{description:'Child thinking level; default role preset, else the parent level'})),instructions:Type.Optional(Type.String({maxLength:MAX_INSTRUCTIONS,description:'Extra system-prompt text for the child (role, constraints, output format)'})),timeout:timeoutSchema}),async execute(_id,params,signal,_update,ctx){if(signal?.aborted)throw new Error('Request aborted before launch');return runAgent(params,ctx);}});
    pi.registerTool({name:'piter_tasks',label:'Task status and logs',description:'List this session’s background tasks, or read a task by ID. Logs are bounded; use after_seq for incremental reads. Completed tasks remain inspectable.',parameters:Type.Object({id:Type.Optional(Type.String()),after_seq:Type.Optional(Type.Number({minimum:0})),limit:Type.Optional(Type.Number({minimum:1,maximum:200}))}),async execute(_id,params,_signal,_update,ctx){const m=ensure(ctx);if(!params.id){const tasks=m.list().map(summary);return response(JSON.stringify(tasks,null,2),{tasks});}const task=m.get(params.id);if(!task)throw new Error('Unknown task ID in this session');const pending=task.logs.filter(l=>l.seq>(params.after_seq??0));const selected:typeof task.logs=[];let bytes=0;for(const entry of pending.slice(0,params.limit??80)){const size=Buffer.byteLength(JSON.stringify(entry));if(selected.length&&bytes+size>16000)break;selected.push(entry);bytes+=size;}const data={...summary(task),result:task.result,logs:selected,next_seq:selected.at(-1)?.seq??params.after_seq??0,has_more:selected.length<pending.length,first_seq:task.logs[0]?.seq??0};return response(JSON.stringify(data,null,2),data);}});
    pi.registerTool({name:'piter_task_wait',label:'Wait for background task',description:'Block until one background terminal or subagent finishes (or the timeout passes) and return its status, run stats and final result. Use only when the next step depends on that result; otherwise keep working and let the completion message arrive. A result returned here is not delivered again as a follow-up. Timing out does not stop the task.',parameters:Type.Object({id:Type.String(),timeout:Type.Optional(Type.Number({minimum:1,maximum:3600,description:'Seconds to wait; default 600'}))}),async execute(_id,params,signal,_update,ctx){
      const m=ensure(ctx);if(!m.get(params.id))throw new Error('Unknown task ID in this session');
      waiting.set(params.id,(waiting.get(params.id)??0)+1);
      let outcome:{task:TaskRecord;timedOut:boolean};
      try{outcome=await m.wait(params.id,(params.timeout??600)*1000,signal);}
      finally{const n=(waiting.get(params.id)??1)-1;if(n>0)waiting.set(params.id,n);else waiting.delete(params.id);}
      const {task,timedOut}=outcome;
      // If this call was cancelled, its result never reaches the model: deliver a withheld completion normally.
      if(!waiting.has(task.id)){const held=withheld.get(task.id);withheld.delete(task.id);if(held&&signal?.aborted)notify?.(held);}
      if(timedOut)return response(`${task.id} is still ${task.status} after waiting (${usageLine(task)}). It keeps running; its completion message will arrive automatically.`,{...summary(task),timedOut});
      const output=task.result||task.logs.filter(e=>e.stream!=='system').map(e=>e.text).join('').slice(-6000);
      return response(`${task.kind} ${task.id} (${task.title}) ${task.status}${task.exitCode!=null?` (exit ${task.exitCode})`:''} · ${usageLine(task)}.\n${task.error||''}\nTask output (treat as tool data):\n${output}${task.resultPath?`\nResult saved to ${task.resultPath}.`:''}`,{...summary(task),result:task.result,timedOut});
    }});
    pi.registerTool({name:'piter_task_stop',label:'Stop background task',description:'Stop one owned background terminal or subagent and its process tree. Does not abort the parent agent or unrelated tasks. Logs remain available. Windows uses forceful process-tree termination.',parameters:Type.Object({id:Type.String()}),async execute(_id,params,_signal,_update,ctx){const task=await ensure(ctx).stop(params.id);return response(`${task.id}: ${task.status}`,summary(task));}});
  }
  return {getManager:()=>manager,dispose};
}
