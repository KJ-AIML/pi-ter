import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {join} from 'node:path';
import { registerTasks } from '../extensions/tasks/index.ts';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('registered terminal tool streams, reports completion and stops on session switch',async t=>{
 const events=new Map<string,Function>();const tools=new Map<string,any>();const commands=new Map<string,any>();const messages:any[]=[];const shortcuts:string[]=[];
 const root=mkdtempSync(join(tmpdir(),'piter-integration-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pi:any={on:(n:string,f:Function)=>events.set(n,f),registerTool:(v:any)=>tools.set(v.name,v),registerCommand:(n:string,v:any)=>commands.set(n,v),registerShortcut:(s:string)=>shortcuts.push(s),sendMessage:(m:any,o:any)=>messages.push({m,o})};
 const controller=registerTasks(pi,{logRoot:root});t.after(()=>controller.dispose());
 const ctx:any={cwd:process.cwd(),hasUI:false,sessionManager:{getSessionId:()=> 's1'},model:{provider:'test',id:'model'},ui:{}};
 await events.get('session_start')!({},ctx);
 assert.equal(tools.size,4);assert.ok(commands.has('tasks'));assert.ok(commands.has('piter-tasks'));assert.ok(shortcuts.includes('ctrl+alt+t'));
 const r=await tools.get('piter_terminal').execute('x',{command:process.platform==='win32'?'Write-Output test-output':'printf test-output'},undefined,undefined,ctx);
 const id=r.details.id;let end=Date.now()+5000;while(!messages.length&&Date.now()<end)await sleep(20);
 assert.equal(messages.length,1);assert.match(messages[0].m.content,/test-output/);assert.equal(messages[0].o.deliverAs,'followUp');
 const read=await tools.get('piter_tasks').execute('y',{id},undefined,undefined,ctx);assert.match(read.content[0].text,/test-output/);
 const record=controller.getManager()!.get(id)!;
 record.logs=Array.from({length:100},(_,i)=>({seq:i+1,time:Date.now(),stream:'stdout' as const,text:'x'.repeat(1000)}));
 let cursor=0;const seen:number[]=[];
 while(cursor<100){const page=await tools.get('piter_tasks').execute('page',{id,after_seq:cursor,limit:80},undefined,undefined,ctx);const data=JSON.parse(page.content[0].text);seen.push(...data.logs.map((x:any)=>x.seq));assert.ok(data.next_seq>cursor);cursor=data.next_seq;}
 assert.deepEqual(seen,Array.from({length:100},(_,i)=>i+1));
 await assert.rejects(tools.get('piter_task_stop').execute('z',{id:'not-owned'},undefined,undefined,ctx),/Unknown/);
 const live=await tools.get('piter_terminal').execute('live',{command:process.platform==='win32'?'Start-Sleep -Seconds 20':'sleep 20'},undefined,undefined,ctx);
 await events.get('session_before_switch')!({},ctx);assert.equal(controller.getManager(),undefined);
 assert.equal(messages.length,1,'shutdown does not notify a different session');
});
test('subagent environment does not register recursive task tools',()=>{
 const previous=process.env.PITER_SUBAGENT;process.env.PITER_SUBAGENT='1';
 try{const controller=registerTasks({registerTool(){assert.fail('recursive task tool')}} as any);assert.equal(controller.getManager(),undefined);}finally{if(previous===undefined)delete process.env.PITER_SUBAGENT;else process.env.PITER_SUBAGENT=previous;}
});

test('empty Tasks card opens by mouse and raw F6 without using the editor',async t=>{
 const events=new Map<string,Function>();let widget:any,input:any,view:any,close:any;let opens=0,removed=0;let otherOverlay=false;
 const root=mkdtempSync(join(tmpdir(),'piter-open-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pi:any={on:(n:string,f:Function)=>events.set(n,f),registerTool(){},registerCommand(){},registerShortcut(){},sendMessage(){}};
 const tui:any={mode:'fullscreen',terminal:{rows:24},requestRender(){},hasOverlay:()=>otherOverlay};
 const ctx:any={cwd:process.cwd(),hasUI:true,ui:{notify(){},onTerminalInput(fn:any){input=fn;return()=>{input=undefined;removed++;};},setWidget(_key:string,f:any){if(f)widget=f(tui);},custom(factory:any){opens++;return new Promise<void>(done=>{close=done;view=factory(tui,{}, {},done);});}}};
 const c=registerTasks(pi,{logRoot:root});t.after(()=>c.dispose());
 await events.get('session_start')!({},ctx);
 assert.match(widget.render(80).join(''),/Tasks/);
 widget.handleMouse({type:'click',button:'left',x:4,y:1});assert.equal(opens,1);close();await sleep(0);
 assert.deepEqual(input('\x1b[17~'),{consume:true});assert.equal(opens,2);
 assert.equal(input('\x1b[17~'),undefined,'do not intercept inside overlay');close();await sleep(0);
 otherOverlay=true;assert.equal(input('\x1b[17~'),undefined);otherOverlay=false;
 assert.equal(input('t'),undefined,'ordinary typing is preserved');
 await c.dispose();assert.equal(input,undefined);assert.ok(removed>0);
});

test('fullscreen renderer dispatches real SGR mouse input to the Tasks card',async t=>{
 const {TuiAltScreen}=await import('@earendil-works/pi-tui');
 let input:(data:string)=>void=()=>{};let widget:any,opens=0;
 const terminal:any={columns:90,rows:24,kittyProtocolActive:false,start(fn:any){input=fn;},stop(){},write(){},hideCursor(){},showCursor(){},clearLine(){},clearScreen(){},clearFromCursor(){},moveBy(){},setTitle(){},setProgress(){},async drainInput(){}};
 const tui=new TuiAltScreen(terminal);const events=new Map<string,Function>();
 const root=mkdtempSync(join(tmpdir(),'piter-mouse-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pi:any={on:(n:string,f:Function)=>events.set(n,f),registerTool(){},registerCommand(){},registerShortcut(){},sendMessage(){}};
 const ctx:any={cwd:process.cwd(),hasUI:true,ui:{notify(){},onTerminalInput(fn:any){return tui.addInputListener(fn);},setWidget(_k:string,f:any){if(widget)tui.removeChild(widget);if(f){widget=f(tui);tui.addChild(widget);}},custom(factory:any){opens++;return new Promise<void>(done=>{const component=factory(tui,{}, {},()=>{overlay.hide();done();});const overlay=tui.showOverlay(component);});}}};
 const c=registerTasks(pi,{logRoot:root});t.after(async()=>{await c.dispose();tui.stop();});
 await events.get('session_start')!({},ctx);tui.start();tui.renderNow(true);
 input('\x1b[<0;5;2M');input('\x1b[<0;5;2m');
 assert.equal(opens,1,'SGR press/release should synthesize click and open overlay');
 input('\x1b');await sleep(0);assert.equal(tui.hasOverlay(),false);
 input('\x1b[17~');assert.equal(opens,2,'F6 opens without invoking an editor shortcut');
});
