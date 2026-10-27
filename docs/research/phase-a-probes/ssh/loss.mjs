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
 const handle=ctx.subprocess.spawn({argv:['/bin/bash','-c','printf "SIDE_EFFECT\\n" > /workspace/effect.txt; sleep 60'],cwd:'/workspace',stdio:{stdin:'ignore',stdout:{maxBytes:4096},stderr:{maxBytes:4096}},graceMs:500});
 const observed=handle.done.then(v=>({resolved:v}),e=>({error:String(e)}));
 await new Promise(r=>setTimeout(r,300));
 writeFileSync(root+'/loss-ready','ready');
 const outcome=await observed;
 assert.ok(outcome.error);checks.transport_loss=outcome;
 writeFileSync(root+'/loss-result.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
} finally {for(const f of fibers.reverse())await f.dispose();}
