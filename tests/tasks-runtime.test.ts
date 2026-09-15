import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskManager } from '../extensions/tasks/manager.ts';
import { terminalLaunch } from '../extensions/tasks/process.ts';
const sleep = (ms:number) => new Promise(r => setTimeout(r,ms));
async function until(fn:()=>boolean, ms=5000) { const end=Date.now()+ms; while(!fn()) { if(Date.now()>end) assert.fail('condition timed out'); await sleep(15); } }
function setup(t:any, options:any={}) { const dir=mkdtempSync(join(tmpdir(),'piter-tasks-')); const m=new TaskManager({logDir:dir,...options}); t.after(async()=>{ await m.dispose(); rmSync(dir,{recursive:true,force:true}); }); return m; }
const launch = (code:string) => ({kind:'terminal' as const,title:'test',cwd:process.cwd(),command:'node fixture',executable:process.execPath,args:['-e',code],timeoutMs:4000});
test('streams stdout and stderr while concurrent jobs remain independently running',async t=>{
 const m=setup(t); const a=m.start(launch("console.log('ready');setTimeout(()=>console.error('err'),50);setInterval(()=>{},100)"));
 const b=m.start(launch("console.log('second')")); await until(()=>a.logs.some(l=>l.text.includes('ready')));
 assert.equal(a.status,'running'); await until(()=>b.status==='completed'); assert.equal(a.status,'running');
 await until(()=>a.logs.some(l=>l.stream==='stderr')); await m.stop(a.id); assert.equal(a.status,'stopped'); assert.ok(a.logs.some(l=>l.stream==='stderr'&&l.text.includes('err')));
 assert.match(readFileSync(a.logPath,'utf8'),/ready/);
});
test('stop targets only owned task and is idempotent',async t=>{
 const m=setup(t); const a=m.start(launch("setInterval(()=>console.log('tick'),20)")); const b=m.start(launch("setInterval(()=>{},100)"));
 await until(()=>a.logs.some(l=>l.text.includes('tick'))); await m.stop(a.id); assert.equal(a.status,'stopped'); assert.equal(b.status,'running');
 await m.stop(a.id); await assert.rejects(m.stop('not-owned'),/Unknown/); await m.stop(b.id);
});
test('timeout and spawn failures produce truthful final states exactly once',async t=>{
 const m=setup(t); const finished:string[]=[]; m.onComplete(task=>finished.push(task.id));
 const a=m.start({...launch('setInterval(()=>{},100)'),timeoutMs:100});
 const b=m.start({...launch(''),executable:join(tmpdir(),'piter-does-not-exist-123')});
 await until(()=>a.status==='timed_out'&&b.status==='failed'); assert.equal(finished.filter(id=>id===a.id).length,1); assert.equal(finished.filter(id=>id===b.id).length,1);
});
test('output floods are bounded and untrusted terminal control sequences are removed',async t=>{
 const m=setup(t,{maxMemoryBytes:2048,maxLogBytes:4096}); const a=m.start(launch("process.stdout.write('\\x1b]52;c;evil\\x07'+'a'.repeat(50000));console.log('TAIL')"));
 await until(()=>a.status==='completed'); assert.ok(a.logs.reduce((n,l)=>n+Buffer.byteLength(l.text),0)<=2048); assert.ok(a.dropped>0); assert.equal(a.diskTruncated,true);
 assert.ok(Buffer.byteLength(readFileSync(a.logPath))<=4096); assert.ok(a.logs.some(l=>l.text.includes('TAIL'))); assert.doesNotMatch(a.logs.map(l=>l.text).join(''),/\x1b|\x07/);
});
test('concurrency and disposal prevent accidental extra process admission',async t=>{
 const m=setup(t,{maxConcurrent:1}); const a=m.start(launch('setInterval(()=>{},100)')); assert.throws(()=>m.start(launch('')),/limit/);
 await m.dispose(); assert.equal(a.status,'stopped'); assert.throws(()=>m.start(launch('')),/closed/);
});
test('terminal adapter chooses platform shell without interpolating command arguments',()=>{
 const w=terminalLaunch('Write-Output "a & b"','powershell','win32'); assert.equal(w.args.at(-1),'Write-Output "a & b"'); assert.match(w.executable,/powershell/i);
 const p=terminalLaunch('printf hello','auto','linux'); assert.equal(p.args.at(-1),'printf hello');
});
test('stopping task terminates a live child process tree',async t=>{
 const m=setup(t); const a=m.start(launch("const {spawn}=require('child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'}); console.log(c.pid);setInterval(()=>{},100)"));
 await until(()=>a.logs.some(l=>/^\d+/.test(l.text))); const pid=Number(a.logs.find(l=>/^\d+/.test(l.text))!.text.trim());
 await m.stop(a.id); assert.equal(a.status,'stopped');
 await until(()=>{try { if(process.platform==='linux'){const s=readFileSync(`/proc/${pid}/stat`,'utf8'); if(/\) Z /.test(s)) return true;} process.kill(pid,0); return false;}catch{return true;} });
});

test('POSIX retains inherited pipes after its immediate child exits', {skip:process.platform==='win32'?'Windows closes inherited output when the shell exits; managed commands must stay in foreground':false},async t=>{
 const m=setup(t);
 const script="const {spawn}=require('child_process');spawn(process.execPath,['-e',`console.log('descendant-ready');setInterval(()=>{},100)`],{stdio:['ignore',1,2]}).unref()";
 const a=m.start({...launch(''),args:[fileURLToPath(new URL('../extensions/tasks/windows-supervisor.mjs',import.meta.url)),process.execPath,'-e',script]});
 try{await until(()=>a.logs.some(l=>l.text.includes('descendant-ready')));}catch(error){throw new Error(JSON.stringify({status:a.status,error:a.error,logs:a.logs}),{cause:error});}
 await m.stop(a.id);assert.equal(a.status,'stopped');
});
