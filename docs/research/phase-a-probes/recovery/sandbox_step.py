"""One disposable sandbox continuation of an existing DSH Session, official tools only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1])
task = sys.argv[2]
manifest = root / 'sandbox-result.json'
if manifest.exists():
    record = json.loads(manifest.read_text())
    output = Path(record['path'])
    assert hashlib.sha256(output.read_bytes()).hexdigest() == record['sha256']
    print(json.dumps({'reused': True, **record}))
    sys.exit(0)
fixture = Path(os.environ['PROBE_SSH_FIXTURE'])
name = 'orchmesh-phase-a-ssh-bridge-' + hashlib.sha256(task.encode()).hexdigest()[:10]
os.environ.update(PROBE_CONTAINER=name, PROBE_LABEL='orchmesh.experiment=phase-a-bridge', PROBE_ALIGN_RG='1')
sys.path.insert(0, str(fixture))
import lifecycle
output = root / 'artifacts'
output.mkdir(exist_ok=True)
env = {**os.environ, 'PROBE_SESSION_ROOT': str(root / 'sessions'), 'PROBE_SESSION_ID': task,
       'PROBE_ARTIFACT_OUTPUT': str(output), 'PATH': str(fixture / 'bin') + ':' + os.environ['PATH']}
cid = None
try:
    cid = lifecycle.start()
    with (root / 'sandbox-node.log').open('a') as log:
        subprocess.run(['node', str(fixture / 'native-tools.mjs'), 'bridge'], env=env,
                       stdout=log, stderr=subprocess.STDOUT, check=True, timeout=90)
    artifact = output / 'report.txt'
    assert artifact.read_text() == 'NATIVE_WRITE\nNATIVE_BASH\n'
    record = {'container': cid, 'session': task, 'path': str(artifact),
              'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()}
    temporary = manifest.with_suffix('.tmp')
    temporary.write_text(json.dumps(record))
    temporary.replace(manifest)
finally:
    if cid:
        subprocess.run(['docker', 'rm', '-f', cid], check=True, stdout=subprocess.DEVNULL)
print(json.dumps({'reused': False, **record}))
