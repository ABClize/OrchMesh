// A management-only process, never installed as a model tool in task workers.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./node_modules/skills/bin/cli.mjs', import.meta.url));
const p = spawn(process.execPath, [cli, 'add', process.argv[2], '--skill', process.argv[3], '--agent', 'universal', '--copy', '--yes', '--json'], {cwd:process.argv[4], env:{...process.env,DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'},stdio:['ignore','ignore','ignore']});
p.on('exit', code => { if(code) process.exitCode=1; else process.stdout.write('{}'); });
p.on('error', () => {process.exitCode=1;});
