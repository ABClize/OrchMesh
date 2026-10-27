import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { SshConnection } from '@deepseek-ai/dsh-ssh';
import { SshFileSystem } from '@deepseek-ai/dsh-fs-ssh';
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh';
import { SshSandboxProvider } from '@deepseek-ai/dsh-sandbox-ssh';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { NodePtcRuntime } from '@deepseek-ai/dsh-ptc-runtime-node';
const root=import.meta.dirname;
const helper='/opt/probe/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js';
const helperHash=createHash('sha256').update(readFileSync(root+'/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js')).digest('hex');
const ctx=new Context(); const fibers=[]; const checks={};
async function plugin(p,c){const f=ctx.plugin(p,c);fibers.push(f);await f;}
async function run(argv){const h=ctx.subprocess.spawn({argv,cwd:'/workspace',stdio:{stdin:'ignore',stdout:{maxBytes:8192},stderr:{maxBytes:8192}},graceMs:500});const r=await h.done;assert.equal(await h.waitForExit(),true);return {...r,stdout:h.collected.stdout?.readFrom(0).text,stderr:h.collected.stderr?.readFrom(0).text};}
try {
 await plugin(SessionProjectionRegistry);
 await plugin(SandboxPolicyService,{mode:'workspace-write',workspaceRoot:'/workspace'});
 await plugin(SshConnection,{host:'phase-a',launch:{kind:'node-script',node:'/usr/local/bin/node',bootstrapPath:'/opt/probe/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/process.js',bootstrapHash:createHash('sha256').update(readFileSync(root+'/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/process.js')).digest('hex')},helper,helperHash,workspace:'/workspace',requestTimeoutMs:10000,leaseMs:5000});
 await plugin(SshFileSystem);await plugin(SshSubprocessRuntime);await plugin(SshSandboxProvider);
 checks.hello=await ctx.ssh.ready;
 await plugin(NodePtcRuntime,{launch:ctx.ssh.ptcLaunch});
 const ptc=await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({program:"const fs=await import('node:fs/promises');await fs.writeFile('ptc.txt','PTC_REMOTE');return {cwd:process.cwd(),env:Object.keys(process.env)}",bindings:[],cwd:'/workspace',sandboxPolicy:{mode:'workspace-write',workspaceRoot:'/workspace'}}));
 assert.equal(ptc.error,undefined);assert.equal(ptc.value.cwd,'/workspace');assert.deepEqual(ptc.value.env,[]);checks.ptc=ptc;
 const rg=await run(['/usr/bin/rg','PTC_REMOTE','/workspace/ptc.txt']);assert.equal(rg.exitCode,0);checks.rg=rg;
 const file=await ctx.fs.resolve('/workspace/report-ptc.txt');
 const first=await ctx.fs.writeText(file,'alpha\n',{kind:'createIfAbsent'});
 await assert.rejects(ctx.fs.writeText(file,'stale',{kind:'replaceIfVersion',version:'invalid'}),{code:'FS_STALE_VERSION'});
 await ctx.fs.editText(file,{oldString:'alpha',newString:'beta',replaceAll:false},{version:first.version});
 assert.equal(await ctx.fs.readText(file),'beta\n');checks.fs=true;
 await assert.rejects(ctx.fs.writeText(file,'forbidden',undefined,undefined,{mode:'read-only',workspaceRoot:'/workspace'}),{code:'FS_SANDBOX_DENIED'});checks.readonly=true;
 let r=await run(['/bin/bash','-c','cat report-ptc.txt; printf "shell\n" > report-ptc.txt']);assert.equal(r.exitCode,0);assert.equal(r.stdout,'beta\n');assert.equal(await ctx.fs.readText(file),'shell\n');checks.subprocess=true;
 try{const policy=await ctx.sandbox.confine(['/bin/bash','-c','printf "confined\n" > confined.txt'],{mode:'workspace-write',workspaceRoot:'/workspace'});r=await run(policy.argv);checks.sandbox={policy,result:r};}catch(e){checks.sandbox={error:String(e)};}
 assert.equal(checks.sandbox.result?.exitCode,0);
 assert.equal(checks.sandbox.policy?.enforcement,'full');
 const handle=ctx.subprocess.spawn({argv:['/bin/bash','-c','sleep 60 & wait'],cwd:'/workspace',stdio:{stdin:'ignore',stdout:{maxBytes:1024},stderr:{maxBytes:1024}},graceMs:500});
 await new Promise(r=>setTimeout(r,200));handle.terminate();const done=await handle.done;assert.equal(await handle.waitForExit(),true);checks.cancel=done;
 const isolation=await run(['/bin/bash','-c','test ! -e /project/OrchMesh/.env && test ! -e /data && test ! -S /var/run/docker.sock && printf ISOLATED']);assert.equal(isolation.stdout,'ISOLATED');checks.isolation=true;
 writeFileSync(root+'/artifacts/report.txt',await ctx.fs.readText(file));checks.artifact=true;
 console.log(JSON.stringify(checks));writeFileSync(root+'/result.json',JSON.stringify(checks,null,2));
} finally {for(const f of fibers.reverse())await f.dispose();}
