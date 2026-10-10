import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskManager } from '../extensions/tasks/manager.ts';
import { agentLaunch } from '../extensions/tasks/subagent.ts';

test('real Pi CLI child uses configured provider, streams tool activity and returns result', {timeout:45000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'piter-cli-'));const requests:any[]=[];
 writeFileSync(join(dir,'fixture.txt'),'fixture file content');
 const server=createServer((req,res)=>{
  let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
   if(!req.url?.includes('chat/completions')){res.writeHead(404);res.end();return;}
   const input=JSON.parse(body);requests.push(input);
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const send=(delta:any,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta,finish_reason}]})}\n\n`);
   if(requests.length===1){send({role:'assistant',content:'Reading the fixture.\n'});send({tool_calls:[{index:0,id:'call_fixture',type:'function',function:{name:'read',arguments:JSON.stringify({path:join(dir,'fixture.txt')})}}]});send({},'tool_calls');}
   else{send({role:'assistant',content:'Verified fixture file content.'});send({},'stop');}
   res.end('data: [DONE]\n\n');
  });
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as any).port;
 writeFileSync(join(dir,'models.json'),JSON.stringify({providers:{'piter-fixture':{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture',models:[{id:'fixture-model',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1024}]}}}));
 writeFileSync(join(dir,'settings.json'),JSON.stringify({packages:[resolve('.')],quietStartup:true}));
 const manager=new TaskManager({logDir:join(dir,'logs')});
 t.after(async()=>{await manager.dispose();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});
 const spec=agentLaunch({task:'Read fixture.txt then summarize.',title:'CLI integration',cwd:dir,provider:'piter-fixture',model:'fixture-model',thinking:'off',timeoutMs:35000});
 spec.env={...spec.env,PI_CODING_AGENT_DIR:dir};
 const task=manager.start(spec);
 await new Promise<void>((resolve,reject)=>{const poll=setInterval(()=>{if(['completed','failed','stopped','timed_out'].includes(task.status)){clearInterval(poll);resolve();}},30);});
 assert.equal(task.status,'completed',task.logs.map(l=>l.text).join(''));
 assert.match(task.result!,/Verified fixture/);assert.ok(task.logs.some(l=>l.stream==='tool'&&l.text.includes('read')));
 assert.equal(requests.length,2);
 assert.equal(task.usage?.turns,2,'usage counts both assistant turns');
 assert.equal(task.progress?.turns,2);assert.equal(task.progress?.tools,1,'live tool counter saw the read call');
 assert.ok(task.resultPath&&readFileSync(task.resultPath,'utf8').includes('Verified fixture'),'final result saved to a file');
 const tools=requests[0].tools.map((v:any)=>v.function.name);
 assert.ok(!tools.includes('piter_agent'));assert.ok(!tools.includes('piter_terminal'));
 assert.ok(requests[1].messages.some((m:any)=>m.role==='tool'&&JSON.stringify(m.content).includes('fixture file content')));
});

test('scout role is read-only and its prompt reaches the real Pi CLI', {timeout:45000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'piter-cli-ro-'));let offered:string[]|undefined;let system='';
 const server=createServer((req,res)=>{let body='';req.on('data',c=>{body+=c;});req.on('end',()=>{
  if(!req.url?.includes('chat/completions')){res.writeHead(404);res.end();return;}
  const input=JSON.parse(body);offered??=(input.tools||[]).map((v:any)=>v.function.name);system||=JSON.stringify(input.messages.filter((m:any)=>m.role==='system'||m.role==='developer'));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write(`data: ${JSON.stringify({id:'f',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'ok'},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 writeFileSync(join(dir,'models.json'),JSON.stringify({providers:{'piter-fixture':{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture',models:[{id:'fixture-model',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1024}]}}}));
 writeFileSync(join(dir,'settings.json'),JSON.stringify({packages:[resolve('.')],quietStartup:true}));
 const manager=new TaskManager({logDir:join(dir,'logs')});
 t.after(async()=>{await manager.dispose();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});
 const spec=agentLaunch({task:'Say ok.',title:'RO',cwd:dir,provider:'piter-fixture',model:'fixture-model',thinking:'off',role:'scout',instructions:'Answer with MARKER-ROLE-123 style.',timeoutMs:35000});
 spec.env={...spec.env,PI_CODING_AGENT_DIR:dir};const task=manager.start(spec);
 await new Promise<void>(r=>{const p=setInterval(()=>{if(!['starting','running','stopping'].includes(task.status)){clearInterval(p);r();}},30);});
 assert.equal(task.status,'completed',task.logs.map(l=>l.text).join(''));
 assert.ok(offered?.length,'model was offered tools');
 for(const name of offered!)assert.ok(['read','grep','find','ls'].includes(name),`unexpected tool offered: ${name}`);
 assert.match(system,/Subagent role: scout/);assert.match(system,/MARKER-ROLE-123/);
 assert.ok(!offered!.includes('bash')&&!offered!.includes('write')&&!offered!.includes('edit'));
});
