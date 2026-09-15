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
