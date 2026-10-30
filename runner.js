'use strict';
const { spawn } = require('node:child_process');
let child, restartTimer, watchdog, forceKill, stopping = false;
function start() {
  const proc = spawn(process.execPath, ['index.js'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], cwd: __dirname });
  child = proc;
  // Allow initial device-code sign-in. Once ready, detect a frozen child too.
  let deadline = Date.now() + 15 * 60 * 1000;
  proc.on('message', msg => {
    if (msg?.type === 'ready' || msg?.type === 'heartbeat') deadline = Date.now() + 120000;
  });
  watchdog = setInterval(() => {
    if (Date.now() < deadline || forceKill) return;
    console.error('[WATCHDOG] BOT stopped responding; rebuilding session');
    proc.kill('SIGTERM');
    forceKill = setTimeout(() => proc.kill('SIGKILL'), 7000);
  }, 10000);
  proc.on('error', e => console.error('[PROCESS]', e.message));
  proc.on('close', () => {
    clearInterval(watchdog); clearTimeout(forceKill); forceKill = null;
    if (stopping) return process.exit(0);
    console.log('[RESTART] Rebuilding world session in 30 seconds');
    restartTimer = setTimeout(start, 30000);
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer); clearInterval(watchdog);
  if (child && child.exitCode === null) {
    child.kill(signal);
    clearTimeout(forceKill);
    forceKill = setTimeout(() => child.kill('SIGKILL'), 7000);
  } else process.exit(0);
});
start();
