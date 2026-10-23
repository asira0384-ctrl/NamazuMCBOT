'use strict';
// No startup friend-list scan: only newly accepted/added friends get automatic invites.
function createInvites(portal, { log = console.log, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  const state = { ready: false, lastInvite: '', lastError: '', batch: { running: false, total: 0, sent: 0, failed: 0 } };
  let stopped = false, busy = false, again = false, lastFollowers = 0, backoffUntil = 0, lastBatch = 0;
  let timer, listener, sendChain = Promise.resolve();
  const autoPending = new Set();
  const recentlyAccepted = new Map();
  function error(label, e) {
    const message = String(e?.message || e).replace(/XBL3\.0\s+\S+/g, '[REDACTED]').slice(0, 500);
    state.lastError = label + ': ' + message; log('[MC ERROR] ' + state.lastError);
    if (/429/.test(message)) backoffUntil = now() + 60000;
  }
  function send(xuid, name, reason) {
    const run = sendChain.then(async () => {
      for (let attempt = 1; attempt <= 3 && !stopped; attempt++) {
        if (now() < backoffUntil) await sleep(backoffUntil - now());
        if (stopped) return false;
        try {
          await portal.invitePlayer(String(xuid));
          state.lastInvite = name + ' / ' + reason + ' / ' + new Date().toISOString();
          log('[INVITE API ACCEPTED] ' + state.lastInvite + ' (client receipt is not confirmed)');
          await sleep(2000); return true;
        } catch(e) { error('invite ' + name + ' attempt ' + attempt + '/3', e); if (attempt < 3) await sleep(5000 * attempt); }
      }
      return false;
    });
    sendChain = run.catch(e => { error('queue', e); return false; });
    return run;
  }
  function onAccepted(person) {
    const id = String(person.xuid);
    if (!/^\d+$/.test(id) || autoPending.has(id) || (recentlyAccepted.has(id) && now() - recentlyAccepted.get(id) < 60000)) return;
    recentlyAccepted.set(id, now());
    for (const [key, time] of recentlyAccepted) if (now() - time >= 60000) recentlyAccepted.delete(key);
    autoPending.add(id);
    log('[FRIEND ACCEPTED] ' + person.gamertag);
    // Give Xbox time to propagate the relationship; invite even if friends list is stale.
    void (async () => {
      await sleep(2000);
      if (!stopped) await send(id, person.gamertag || id, 'new friend');
    })().catch(e => error('automatic invite', e)).finally(() => autoPending.delete(id));
  }
  async function sync() {
    if (stopped || !state.ready || now() < backoffUntil) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const rest = portal.host.rest;
      const requests = await rest.getFriendRequestsReceived();
      if (requests.length) {
        const accepted = await rest.acceptFriendRequests(requests.map(p => p.xuid));
        const ids = new Set((accepted.updatedPeople || []).map(String));
        for (const p of requests) if (ids.has(String(p.xuid))) onAccepted(p);
      }
      if (now() - lastFollowers >= 15000) {
        lastFollowers = now();
        const followers = await rest.getXboxFollowers();
        for (const p of followers.filter(p => !p.isFollowedByCaller)) {
          if (stopped || now() < backoffUntil) break;
          // Avoid treating a just-accepted request as another follower addition.
          if (autoPending.has(String(p.xuid))) continue;
          await rest.addXboxFriend(p.xuid); onAccepted(p);
        }
      }
    } catch(e) { error('friend sync', e); }
    finally { busy = false; if (again) { again = false; void sync(); } }
  }
  async function runBatch() {
    try {
      const friends = await portal.host.rest.getXboxFriends();
      const unique = [...new Map(friends.map(p => [String(p.xuid), p])).values()];
      state.batch.total = unique.length;
      for (const p of unique) {
        if (stopped) break;
        const ok = await send(p.xuid, p.gamertag || p.xuid, 'manual batch');
        state.batch[ok ? 'sent' : 'failed']++;
      }
    } catch(e) { error('invite all', e); state.batch.error = state.lastError; }
    finally { state.batch.running = false; state.batch.finishedAt = new Date().toISOString(); }
  }
  function inviteAll() {
    if (!state.ready || stopped) throw Error('Minecraft BOT is not ready');
    if (state.batch.running) throw Error('An invitation batch is already running');
    if (lastBatch && now() - lastBatch < 60000) throw Error('Wait 60 seconds between batches');
    lastBatch = now(); state.batch = { running: true, total: 0, sent: 0, failed: 0 };
    void runBatch(); return state.batch;
  }
  async function start() {
    if (state.ready) return;
    state.ready = true;
    const host = portal.host;
    listener = event => { if (event?.data?.NotificationType === 'IncomingFriendRequestCountChanged') void sync(); };
    host.rta.on('event', listener);
    try { await host.rta.subscribe(`https://social.xboxlive.com/users/xuid(${host.profile.xuid})/friends`); }
    catch(e) { error('friend events (polling remains active)', e); }
    await sync(); timer = setInterval(() => { void sync(); }, 5000);
  }
  function stop() { stopped = true; state.ready = false; clearInterval(timer); if (listener) portal.host.rta?.removeListener('event', listener); }
  return { state, start, stop, sync, inviteAll, onAccepted, drained: () => sendChain };
}
module.exports = { createInvites };
