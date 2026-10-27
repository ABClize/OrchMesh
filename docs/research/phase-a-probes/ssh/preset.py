import subprocess,time
from pathlib import Path
r=Path(__file__).parent
marker=r/'preset-ready'
marker.unlink(missing_ok=True)
with (r/'preset-seed.log').open('w') as f:
 p=subprocess.Popen(['node',str(r/'preset.mjs'),'seed'],stdout=f,stderr=f)
 try:
  for _ in range(100):
   if marker.exists():break
   if p.poll() is not None:raise RuntimeError((r/'preset-seed.log').read_text())
   time.sleep(.1)
  assert marker.exists()
  p.kill();assert p.wait()==-9
 finally:
  if p.poll() is None:p.kill();p.wait()
out=subprocess.check_output(['node',str(r/'preset.mjs'),'resume'],text=True)
(r/'preset-resume.log').write_text(out)
print(out)
