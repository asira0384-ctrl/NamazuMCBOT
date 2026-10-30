'use strict';
require('./protocol-compat');
const fs = require('node:fs');
const path = require('node:path');
const { BedrockPortal, Joinability } = require('bedrock-portal');
const config = require('./config.json');
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const ip = (process.env.IP || process.env.SERVER_HOST || config.serverHost).trim();
const port = Number(process.env.PORT || process.env.SERVER_PORT || config.serverPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535');
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
    version: '1.26.60' },
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
portal.on('playerJoin', () => { log('XBOX SESSION JOINED (transfer not yet confirmed)'); health.requestRefresh(); });
portal.on('playerLeave', () => { log('XBOX SESSION LEFT; refreshing world publication'); health.requestRefresh(); });
// Observe actual game connection stages without logging auth packets or tokens.
portal.server.on('connect', client => {
  log('[CLIENT] NetherNet connected');
  const write = client.write.bind(client);
  client.write = (name, params) => {
    try {
      const result = write(name, params);
      if (name === 'transfer') log(`[TRANSFER SENT] ${params.server_address}:${params.port} (arrival not confirmed)`);
      if (name === 'play_status' && String(params.status).startsWith('failed')) log(`[CLIENT REJECTED] ${params.status}`);
      return result;
    } catch (e) {
      log(`[PACKET ERROR] ${name}`);
      throw e;
    }
  };
  client.on('login', () => log(`[CLIENT LOGIN] protocol=${client.version}`));
  client.on('close', () => { log('[CLIENT] Disconnected; host remains open'); health.requestRefresh(); });
});
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
