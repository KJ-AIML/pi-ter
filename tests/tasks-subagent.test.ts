import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentOutput, agentLaunch } from '../extensions/tasks/subagent.ts';
test('agent JSON parser streams text, tools and final result across chunk boundaries',()=>{
 const p=new AgentOutput(); const lines=[{type:'message_start'},{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Hello'}},{type:'tool_execution_start',toolName:'read',args:{path:'a.ts'},toolCallId:'1'},{type:'tool_execution_update',toolCallId:'1',partialResult:{content:[{type:'text',text:'file data'}]}},{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Hello'}],stopReason:'stop'}}].map(e=>JSON.stringify(e)+'\n').join('');
 const out=[...p.consume('stdout',lines.slice(0,17)),...p.consume('stdout',lines.slice(17))];
 assert.ok(out.some(e=>e.stream==='agent'&&e.text==='Hello'));assert.ok(out.some(e=>e.stream==='tool'&&e.text.includes('read')));assert.equal(p.summary().result,'Hello');assert.equal(p.summary().error,undefined);
});
test('provider failure is not reported as completed when process exits zero',()=>{
 const p=new AgentOutput();p.consume('stdout',JSON.stringify({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'provider unavailable'}})+'\n');assert.match(p.summary().error!,/provider unavailable/);
});
test('truncated final JSON and oversized lines cannot grow parser unbounded',()=>{
 const p=new AgentOutput();p.consume('stdout','a'.repeat(1100000));assert.ok(p.summary().error); const q=new AgentOutput();q.consume('stdout',JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop'}}));assert.equal(q.summary().result,'done');
});
test('launch uses stdin for task and explicitly inherits model, provider and recursion guard',()=>{
 const s=agentLaunch({task:'Review "x" & y\nnew line',title:'Review',cwd:process.cwd(),provider:'custom',model:'test-model',sessionDir:'/tmp/piter-s',thinking:'low'});
 assert.equal(s.input,'Review "x" & y\nnew line');assert.ok(s.args.includes('--provider'));assert.ok(s.args.includes('custom'));assert.ok(s.args.includes('test-model'));assert.equal(s.env!.PITER_SUBAGENT,'1');assert.ok(!s.args.includes(s.input!));
 assert.equal(s.args[s.args.indexOf('--mode')+1],'rpc');assert.equal(s.args[s.args.indexOf('--session-dir')+1],'/tmp/piter-s');assert.ok(!s.args.includes('--no-session'));
 const written:string[]=[];let ended=0;s.interactive!.attach(t=>written.push(t),()=>ended++);
 assert.deepEqual(JSON.parse(written[0]),{id:'start',type:'prompt',message:'Review "x" & y\nnew line'},'task goes over stdin as the first RPC prompt');
 s.interactive!.send('steer','focus on auth');s.interactive!.send('followUp','then summarize');
 assert.deepEqual(written.slice(1).map(w=>{const r=JSON.parse(w);return [r.type,r.message];}),[['steer','focus on auth'],['follow_up','then summarize']]);
 s.transform!('stdout',JSON.stringify({type:'extension_ui_request',id:'ui1',method:'confirm',title:'Allow?'})+'\n');
 assert.deepEqual(JSON.parse(written.at(-1)!),{type:'extension_ui_response',id:'ui1',cancelled:true},'child dialogs are cancelled, never left hanging');
 assert.equal(ended,0);s.transform!('stdout',JSON.stringify({type:'agent_settled'})+'\n');assert.equal(ended,1,'stdin closes once the child settles');
 assert.throws(()=>s.interactive!.send('steer','late'),/closed/);
});
test('tool access options map to enforced Pi CLI flags and reject injection',async()=>{
 const {toolArgs}=await import('../extensions/tasks/subagent.ts');
 assert.deepEqual(toolArgs({}),[]);
 assert.deepEqual(toolArgs({access:'read-only'}),['--tools','read,grep,find,ls','--exclude-tools','bash,edit,write,mcp,mcp__*']);
 assert.deepEqual(toolArgs({access:'read-only',tools:['read','bash']}),['--tools','read,bash','--exclude-tools','bash,edit,write,mcp,mcp__*'],'deny wins: read-only cannot be widened');
 assert.deepEqual(toolArgs({tools:['read',' read '],excludeTools:['web_search']}),['--tools','read','--exclude-tools','web_search']);
 assert.throws(()=>toolArgs({tools:['read,bash']}),/Invalid tools/);assert.throws(()=>toolArgs({excludeTools:['--x y']}),/Invalid excludeTools/);
 assert.throws(()=>toolArgs({access:'admin' as any}),/Unknown access/);
 const s=agentLaunch({task:'t',title:'t',cwd:process.cwd(),provider:'p',model:'m',sessionDir:'/tmp/piter-s',access:'read-only'});assert.ok(s.args.includes('--exclude-tools'));
});
test('role presets set access, thinking and prompt; explicit options win',()=>{
 const base={task:'t',title:'t',cwd:process.cwd(),provider:'p',model:'m',sessionDir:'/tmp/piter-s'};
 const flag=(args:string[],name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const scout=agentLaunch({...base,role:'scout',parentThinking:'high'}).args;
 assert.equal(flag(scout,'--thinking'),'low');assert.equal(flag(scout,'--tools'),'read,grep,find,ls');assert.match(flag(scout,'--append-system-prompt')!,/Subagent role: scout/);
 const custom=agentLaunch({...base,role:'scout',access:'full',thinking:'medium',instructions:'Report in Thai.'}).args;
 assert.equal(flag(custom,'--thinking'),'medium');assert.equal(flag(custom,'--tools'),undefined);assert.match(flag(custom,'--append-system-prompt')!,/scout[\s\S]*Report in Thai\./);
 const worker=agentLaunch({...base,role:'worker',parentThinking:'xhigh'}).args;assert.equal(flag(worker,'--thinking'),'xhigh');assert.equal(flag(worker,'--exclude-tools'),undefined);
 const plain=agentLaunch({...base,parentThinking:'minimal'}).args;assert.equal(flag(plain,'--append-system-prompt'),undefined);assert.equal(flag(plain,'--thinking'),'minimal');
 const only=agentLaunch({...base,instructions:'README.md'}).args;assert.match(flag(only,'--append-system-prompt')!,/\n/,'never a bare path');
 assert.throws(()=>agentLaunch({...base,thinking:'turbo'}),/thinking/);assert.throws(()=>agentLaunch({...base,role:'boss' as any}),/role/);assert.throws(()=>agentLaunch({...base,instructions:'x'.repeat(8001)}),/instructions/);
});
test('usage is summed across assistant turns and ignores malformed values',()=>{
 const p=new AgentOutput();const end=(usage:any,text='')=>JSON.stringify({type:'message_end',message:{role:'assistant',content:text?[{type:'text',text}]:[],stopReason:'stop',usage}})+'\n';
 p.consume('stdout',end({input:100,output:20,cacheRead:5,cacheWrite:0,totalTokens:125,cost:{total:0.01}})+end({input:-5,output:'x',totalTokens:30,cost:{total:0.002}},'final'));
 const s=p.summary();assert.equal(s.result,'final');assert.deepEqual({...s.usage,cost:Number(s.usage!.cost.toFixed(4))},{input:100,output:20,cacheRead:5,cacheWrite:0,totalTokens:155,cost:0.012,turns:2});
 assert.equal(new AgentOutput().summary().usage,undefined);
});
test('live progress counts turns, tool calls and streaming tokens before the turn ends',()=>{
 const p=new AgentOutput();const send=(e:any)=>p.consume('stdout',JSON.stringify(e)+'\n');
 assert.deepEqual(p.progress(),{turns:0,tools:0,tokens:0,cost:0});
 send({type:'message_start',message:{role:'assistant'}});
 send({type:'message_update',usage:{totalTokens:900,cost:{total:0.01}},assistantMessageEvent:{type:'text_delta',delta:'hi'}});
 assert.deepEqual(p.progress(),{turns:1,tools:0,tokens:900,cost:0.01},'streaming usage counts live');
 send({type:'tool_execution_start',toolCallId:'1',toolName:'read',args:{}});send({type:'tool_execution_start',toolCallId:'2',toolName:'ls',args:{}});
 send({type:'message_end',message:{role:'assistant',content:[],stopReason:'toolUse',usage:{totalTokens:1000,cost:{total:0.02}}}});
 send({type:'message_start',message:{role:'user'}});
 send({type:'message_start',message:{role:'assistant'}});
 send({type:'message_update',usage:{totalTokens:300},assistantMessageEvent:{type:'text_delta',delta:'x'}});
 assert.deepEqual(p.progress(),{turns:2,tools:2,tokens:1300,cost:0.02},'finished usage is not double counted');
});
test('a rejected first prompt fails the task and closes the child',()=>{
 const s=agentLaunch({task:'t',title:'t',cwd:process.cwd(),provider:'p',model:'m',sessionDir:'/tmp/piter-s'});let ended=0;s.interactive!.attach(()=>{},()=>ended++);
 const out=s.transform!('stdout',JSON.stringify({id:'start',type:'response',command:'prompt',success:false,error:'No model'})+'\n');
 assert.equal(ended,1);assert.match(out[0].text,/prompt rejected: No model/);assert.match(s.summarize!().error!,/No model/);
});
