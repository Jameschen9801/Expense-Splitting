import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'expense-worker-test-'));
let worker, output = '';
try {
  const signup = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const service = await signup.json();
  if (!service.localId || !service.refreshToken) throw new Error('Start the local Auth/Database emulators first.');
  const session = JSON.stringify({ uid: service.localId, refreshToken: service.refreshToken });
  const envFile = join(temporary, 'worker.env');
  await writeFile(envFile, 'FIREBASE_SERVICE_SESSION=' + session + '\n', { mode: 0o600 });
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', TEST_WORKER_UID: service.localId };
  worker = spawn(process.execPath, ['worker/node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', 'worker/wrangler.test.jsonc', '--env-file', envFile, '--ip', '127.0.0.1', '--port', '8787', '--persist-to', join(temporary, 'state')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', value => { output = (output + value).slice(-12000); });
  worker.stderr.on('data', value => { output = (output + value).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch('http://127.0.0.1:8787/health'); if ((await response.json()).platform === 'cloudflare-workers') { ready = true; break; } } catch {}
    if (worker.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Local Worker did not start. ' + output.replaceAll(service.refreshToken, '[redacted]'));
  const tests = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', 'worker/src/api.test.ts', 'worker/src/firebaseToken.test.ts'], { cwd: root, env, stdio: 'inherit' });
  process.exitCode = await new Promise(resolve => tests.once('exit', code => resolve(code ?? 1)));
  if (process.exitCode) console.error(output.replaceAll(service.refreshToken, '[redacted]').split('\n').filter(line => line.includes('Local bank test:')).slice(-20).join('\n'));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (worker && worker.exitCode === null) { worker.kill('SIGTERM'); await new Promise(resolve => worker.once('exit', resolve)); } await rm(temporary, { recursive: true, force: true }); }
