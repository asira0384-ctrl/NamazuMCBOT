'use strict';
const { spawn } = require('node:child_process');
let child, timer, stopping = false;
function start() {
  child = spawn(process.execPath, ['index.js'], { stdio: 'inherit', cwd: __dirname });
  child.on('error', (e) => console.error('[PROCESS]', e.message));
  child.on('exit', () => {
    if (stopping) return process.exit(0);
    console.log('[RESTART] 30秒後に再起動します');
    timer = setTimeout(start, 30000);
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;
  clearTimeout(timer);
  if (child && child.exitCode === null) child.kill(signal);
  else process.exit(0);
  setTimeout(() => process.exit(0), 7000).unref();
});
start();
