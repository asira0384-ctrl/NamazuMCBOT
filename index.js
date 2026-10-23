'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BedrockPortal, Joinability, Modules } = require('bedrock-portal');
const config = require('./config.json');
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const ip = process.env.SERVER_HOST || config.serverHost;
const port = Number(process.env.SERVER_PORT || config.serverPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SERVER_PORT must be 1-65535');
const cache = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || './data', 'auth');
fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
const portal = new BedrockPortal({
  ip, port,
  joinability: Joinability.FriendsOnly,
  host: {
    username: 'namazu-friend-bot', cache,
    onMsaCode: (code) => {
      log('Sign in with the BOT Microsoft account. Keep the device code private.');
      console.log(code.message);
    },
  },
  world: { name: process.env.WORLD_NAME || config.worldName, hostName: 'NamazuSMP',
    ...(process.env.MC_VERSION ? { version: process.env.MC_VERSION } : {}) },
});
const { createInvites } = require('./invites');
const invites = createInvites(portal);
portal.on('sessionCreated', () => {
  log(`READY: ${ip}:${port}; automatic invites only after new friend acceptance`);
  invites.start().catch(e => console.error('[FRIEND START ERROR]', e.message));
});
const { startApi } = require('./control-api');
const api = startApi(invites);
portal.on('playerJoin', () => log('PLAYER JOINED redirect session'));
let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  invites.stop();
  api.close();
  const timer = setTimeout(() => process.exit(code), 5000);
  try { await portal.end(); } catch (_) { /* partial startup */ }
  clearTimeout(timer);
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error('[ERROR]', e.message); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error('[ERROR]', e?.message || 'Unexpected rejection'); shutdown(1); });
log(`START: ${ip}:${port}`);
portal.start().catch((e) => { console.error('[START ERROR]', e.message); shutdown(1); });
