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
      log('BOT用Microsoftアカウントで認証してください（コードは公開しないでください）');
      console.log(code.message);
    },
  },
  world: { name: process.env.WORLD_NAME || config.worldName, hostName: 'NamazuSMP',
    ...(process.env.MC_VERSION ? { version: process.env.MC_VERSION } : {}) },
});
portal.use(Modules.AutoFriendAccept, { inviteOnAdd: false });
portal.use(Modules.AutoFriendAdd, { inviteOnAdd: false, checkInterval: 30000 });
portal.on('sessionCreated', () => log(`公開完了: ${ip}:${port} | Botのゲーマータグをフレンド追加して参加してください`));
portal.on('friendAdded', () => log('フレンドを追加しました'));
portal.on('playerJoin', () => log('プレイヤーが転送用セッションに参加しました'));
let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(code), 5000);
  try { await portal.end(); } catch (_) { /* partial startup */ }
  clearTimeout(timer);
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error('[ERROR]', e.message); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error('[ERROR]', e?.message || 'Unexpected rejection'); shutdown(1); });
log(`起動: ${ip}:${port}`);
portal.start().catch((e) => { console.error('[START ERROR]', e.message); shutdown(1); });
