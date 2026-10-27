import json, os, subprocess, time
from pathlib import Path
r=Path(__file__).parent
name=os.environ.get('PROBE_CONTAINER','orchmesh-phase-a-ssh-probe')
label=os.environ.get('PROBE_LABEL','orchmesh.phase-a=ssh-20261027')
def run(*args,**kw):return subprocess.check_output(args,text=True,**kw).strip()
def start():
 mounts=[]
 if os.environ.get('PROBE_ALIGN_RG')=='1':
  rg=r/'node_modules/@vscode/ripgrep-linux-x64/bin/rg'
  mounts=['--mount',f'type=bind,src={rg},dst={rg},readonly']
 cid=run('docker','run','-d','--name',name,'--label',label,'--publish','127.0.0.1::22','--mount',f'type=bind,src={r}/node_modules,dst=/opt/probe/node_modules,readonly','--mount',f'type=bind,src={r}/keys/id_ed25519.pub,dst=/home/node/.ssh/authorized_keys,readonly','--tmpfs','/tmp:rw,nosuid,nodev','--memory','512m','--cpus','1','--pids-limit','128',*mounts,os.environ.get('PROBE_IMAGE','orchmesh-phase-a-ssh:20261027'))
 port=run('docker','port',name,'22').split(':')[-1]
 for _ in range(30):
  try:
   keys=run('ssh-keyscan','-p',port,'127.0.0.1',stderr=subprocess.DEVNULL)
   break
  except subprocess.CalledProcessError: time.sleep(.1)
 (r/'keys/known_hosts').write_text(keys+'\n')
 (r/'ssh_config').write_text(f'Host phase-a\n HostName 127.0.0.1\n Port {port}\n User node\n IdentityFile {r}/keys/id_ed25519\n IdentitiesOnly yes\n UserKnownHostsFile {r}/keys/known_hosts\n StrictHostKeyChecking yes\n')
 return cid
if __name__=='__main__':
 results=[]
 assert run('docker','ps','-a','--filter',f'label={label}','--format','{{.Names}}')==''
 results.append({'phase':'ordinary','containers':0,'evidence':'session-plain.json'})
 try:
  for phase in ['remote','recreated']:
   cid=start()
   env={**os.environ,'PATH':str(r/'bin')+':'+os.environ['PATH']}
   out=run('node',str(r/'session.mjs'),phase,env=env)
   run('docker','rm','-f',name)
   artifact=(r/f'artifacts/task-{phase}.txt').read_text()
   assert artifact=='RESTORED_INPUT\nARTIFACT\n'
   results.append({'phase':phase,'container':cid,'session':json.loads(out),'artifact_after_removal':artifact})
  assert results[1]['container']!=results[2]['container']
  (r/'lifecycle-result.json').write_text(json.dumps(results,indent=2))
  print(json.dumps(results,indent=2))
 finally:
  if run('docker','ps','-a','--filter',f'name=^{name}$','--format','{{.Names}}'):
   run('docker','rm','-f',name)
