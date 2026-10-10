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
 const s=agentLaunch({task:'Review "x" & y\nnew line',title:'Review',cwd:process.cwd(),provider:'custom',model:'test-model',thinking:'low'});
 assert.equal(s.input,'Review "x" & y\nnew line');assert.ok(s.args.includes('--provider'));assert.ok(s.args.includes('custom'));assert.ok(s.args.includes('test-model'));assert.equal(s.env!.PITER_SUBAGENT,'1');assert.ok(s.args.includes('--no-session'));assert.ok(!s.args.includes(s.input!));
});
test('tool access options map to enforced Pi CLI flags and reject injection',async()=>{
 const {toolArgs}=await import('../extensions/tasks/subagent.ts');
 assert.deepEqual(toolArgs({}),[]);
 assert.deepEqual(toolArgs({access:'read-only'}),['--tools','read,grep,find,ls','--exclude-tools','bash,edit,write,mcp,mcp__*']);
 assert.deepEqual(toolArgs({access:'read-only',tools:['read','bash']}),['--tools','read,bash','--exclude-tools','bash,edit,write,mcp,mcp__*'],'deny wins: read-only cannot be widened');
 assert.deepEqual(toolArgs({tools:['read',' read '],excludeTools:['web_search']}),['--tools','read','--exclude-tools','web_search']);
 assert.throws(()=>toolArgs({tools:['read,bash']}),/Invalid tools/);assert.throws(()=>toolArgs({excludeTools:['--x y']}),/Invalid excludeTools/);
 assert.throws(()=>toolArgs({access:'admin' as any}),/Unknown access/);
 const s=agentLaunch({task:'t',title:'t',cwd:process.cwd(),provider:'p',model:'m',access:'read-only'});assert.ok(s.args.includes('--exclude-tools'));
});
