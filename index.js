'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BedrockPortal, Joinability, Modules } = require('bedrock-portal');
const config = require('./config.json');
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const ip = process.env.SERVER_HOST || config.serverHost;
const port = Number(process.env.SERVER_PORT || config.serverPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SERVER_PORT must be 1-65535');
const cache = path.resolve(process.env.DATA_DIR || './data', 'auth');
fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
const portal = new BedrockPortal({
  ip, port,
  joinability: Joinability.FriendsOnly,
  host: {
    username: 'namazu-friend-bot', cache,
    onMsaCode: (code) => {
      log('BOTç”¨Microsoftã‚¢ã‚«ã‚¦ãƒ³ãƒˆã§èªè¨¼ã—ã¦ãã ã•ã„ï¼ˆã‚³ãƒ¼ãƒ‰ã¯å…¬é–‹ã—ãªã„ã§ãã ã•ã„ï¼‰');
      console.log(code.message);
    },
  },
  world: { name: process.env.WORLD_NAME || config.worldName, hostName: 'NamazuSMP',
    ...(process.env.MC_VERSION ? { version: process.env.MC_VERSION } : {}) },
});
// Invitation delivery is handled here so failures are visible and retryable.
portal.use(Modules.AutoFriendAdd, { inviteOnAdd: false, checkInterval: 30000 });
const sentFile = path.join(cache, 'invited-friends.json');
let sent = new Set();
try { sent = new Set(JSON.parse(fs.readFileSync(sentFile, 'utf8'))); }
catch (e) { if (e.code !== 'ENOENT') log('æ‹›å¾…å±¥æ­´ã‚’èª­ã‚ã¾ã›ã‚“: ' + e.message); }
const attempts = new Map();
let syncing = false;
let inviteTimer;
function rememberInvite(xuid) {
  sent.add(xuid);
  try {
    fs.writeFileSync(sentFile + '.tmp', JSON.stringify([...sent]), { mode: 0o600 });
    fs.renameSync(sentFile + '.tmp', sentFile);
  } catch (e) { log('æ‹›å¾…å±¥æ­´ã®ä¿å­˜å¤±æ•—: ' + e.message); }
}
async function syncInvites() {
  if (syncing || stopping) return;
  syncing = true;
  try {
    const rest = portal.host.rest;
    // Poll pending requests too: requests received before startup have no live event.
    try {
      const requests = await rest.getFriendRequestsReceived();
      if (requests.length) {
        const accepted = await rest.acceptFriendRequests(requests.map(p => p.xuid));
        log('ãƒ•ãƒ¬ãƒ³ãƒ‰ç”³è«‹æ‰¿èª: ' + accepted.updatedPeople.length + 'ä»¶');
      }
    } catch (e) { log('[FRIEND ERROR] ' + e.message); }
    const friends = await rest.getXboxFriends();
    for (const friend of friends) {
      if (stopping) break;
      const xuid = String(friend.xuid);
      if (!/^\d+$/.test(xuid) || sent.has(xuid)) continue;
      const count = attempts.get(xuid) || 0;
      if (count >= 3) continue;
      attempts.set(xuid, count + 1);
      try {
        await portal.invitePlayer(xuid);
        rememberInvite(xuid);
        log('æ‹›å¾…é€ä¿¡æˆåŠŸ: ' + friend.gamertag);
      } catch (e) {
        log('[INVITE ERROR] ' + friend.gamertag + ' (' + (count + 1) + '/3): ' + e.message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (e) { log('[FRIEND LIST ERROR] ' + e.message); }
  finally { syncing = false; }
}
portal.on('sessionCreated', () => {
  log(`å…¬é–‹å®Œäº†: ${ip}:${port} | è‡ªå‹•æ‹›å¾…ONï¼ˆæ—¢å­˜ãƒ•ãƒ¬ãƒ³ãƒ‰ã‚‚æœªé€ä¿¡ãªã‚‰æ‹›å¾…ï¼‰`);
  void syncInvites();
  clearInterval(inviteTimer);
  inviteTimer = setInterval(() => { void syncInvites(); }, 30000);
});
portal.on('friendAdded', () => { log('ãƒ•ãƒ¬ãƒ³ãƒ‰ã‚’è¿½åŠ ã—ã¾ã—ãŸ'); void syncInvites(); });
portal.on('playerJoin', () => log('ãƒ—ãƒ¬ã‚¤ãƒ¤ãƒ¼ãŒè»¢é€ç”¨ã‚»ãƒƒã‚·ãƒ§ãƒ³ã«å‚åŠ ã—ã¾ã—ãŸ'));
let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(inviteTimer);
  const timer = setTimeout(() => process.exit(code), 5000);
  try { await portal.end(); } catch (_) { /* partial startup */ }
  clearTimeout(timer);
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error('[ERROR]', e.message); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error('[ERROR]', e?.message || 'Unexpected rejection'); shutdown(1); });
log(`èµ·å‹•: ${ip}:${port}`);
portal.start().catch((e) => { console.error('[START ERROR]', e.message); shutdown(1); });
