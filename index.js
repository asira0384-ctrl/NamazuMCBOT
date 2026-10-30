'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BedrockPortal, Joinability } = require('bedrock-portal');
const config = require('./config.json');
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const ip = process.env.SERVER_HOST || config.serverHost;
const port = Number(process.env.SERVER_PORT || config.serverPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SERVER_PORT must be 1-65535');
const cache = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || './data', 'auth');
fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
const portal = new BedrockPortal({
  ip, port,
  updatePresence: false, // world-health owns presence refresh and recovery
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
const { createWorldHealth } = require('./world-health');
const health = createWorldHealth(portal, { recover: () => shutdown(1), log });
invites.state.world = health.state;
// Upstream end(true) reuses an unclosed NetherNet server. Recreate the process
// instead, so sockets, listeners and friendship loops cannot accumulate.
const endPortal = portal.end.bind(portal);
portal.end = (resume = false) => resume ? shutdown(1) : endPortal(false);
let heartbeat;

portal.on('sessionCreated', () => {
  log(`READY: ${ip}:${port}; automatic invites only after new friend acceptance`);
  health.start();
  process.send?.({ type: 'ready' });
  heartbeat = setInterval(() => process.send?.({ type: 'heartbeat' }), 10000);
  log(`TRANSPORT: NetherNet; game=${portal.server.options.version}; protocol=${portal.server.options.protocolVersion}`);
  invites.start().catch(e => console.error('[FRIEND START ERROR]', e.message));
});
const { startApi } = require('./control-api');
const api = startApi(invites);
portal.on('playerJoin', () => log('PLAYER JOINED redirect session'));
let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  health.stop();
  clearInterval(heartbeat);
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
