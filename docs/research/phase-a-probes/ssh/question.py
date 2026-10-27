import subprocess,time
from pathlib import Path
r=Path(__file__).parent
marker=r/'question-ready'
marker.unlink(missing_ok=True)
with (r/'question-seed.log').open('w') as f:
 p=subprocess.Popen(['node',str(r/'question.mjs'),'seed'],stdout=f,stderr=f)
 try:
  for _ in range(100):
   if marker.exists():break
   if p.poll() is not None:raise RuntimeError((r/'question-seed.log').read_text())
   time.sleep(.1)
  assert marker.exists()
  p.kill();assert p.wait()==-9
 finally:
  if p.poll() is None:p.kill();p.wait()
out=subprocess.check_output(['node',str(r/'question.mjs'),'resume'],text=True)
(r/'question-resume.log').write_text(out)
print(out)
