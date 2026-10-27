import subprocess, os, time, json
from lifecycle import r,start,run,name,label
marker=r/'loss-ready'
marker.unlink(missing_ok=True)
cid=start()
proc=None
try:
 with (r/'loss.log').open('w') as f:
  proc=subprocess.Popen(['node',str(r/'loss.mjs')],env={**os.environ,'PATH':str(r/'bin')+':'+os.environ['PATH']},stdout=f,stderr=f)
  for _ in range(100):
   if marker.exists():break
   if proc.poll() is not None:raise RuntimeError((r/'loss.log').read_text())
   time.sleep(.1)
  assert marker.exists()
  run('docker','rm','-f',name)
  assert proc.wait(timeout=15)==0
 print((r/'loss-result.json').read_text())
finally:
 if proc is not None and proc.poll() is None:
  proc.kill();proc.wait()
 if run('docker','ps','-a','--filter',f'name=^{name}$','--format','{{.Names}}'):run('docker','rm','-f',name)
