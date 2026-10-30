'use strict';
// Checked against bedrock-portal 2.8.1 / bedrock-portal-nethernet 2.8.0.
// Refreshes the existing activity; never sends friend invitations.
function createWorldHealth(portal, { recover, log = console.log, now = Date.now,
  interval = setInterval, cancel = clearInterval, timeoutMs = 15000 } = {}) {
  const state = { status: 'starting', lastRefresh: null, failures: 0 };
  let timer, stopped = false, busy = false, downSince = null, nextRefresh = 0, lastAttempt = -Infinity, rateUntil = 0;
  async function bounded(fn) {
    let timeout;
    try {
      return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('WORLD_REQUEST_TIMEOUT')), timeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
  }
  function restart(reason) {
    if (stopped) return;
    stop(); state.status = 'recovering';
    log('[WORLD RECOVERY] ' + reason);
    recover(reason);
  }
  async function check() {
    if (stopped || busy) return;
    const host = portal.host;
    const signal = portal.server?.signaling;
    if (host.rta?.ws?.readyState !== 1 || signal?.ws?.readyState !== 1) {
      state.status = 'disconnected';
      if (downSince === null) { downSince = now(); log('[WORLD] Connection lost; waiting up to 60s for reconnect'); }
      if (now() - downSince >= 60000) restart('Xbox or NetherNet connection remained disconnected');
      return;
    }
    downSince = null;
    if (!signal.pmsgId || signal.pmsgId !== portal.session.pmsgId) {
      return restart('NetherNet identity changed; rebuilding published session');
    }
    if (now() < nextRefresh || now() < rateUntil) return;
    busy = true;
    // At most one renewal every two minutes, never an overlapping request.
    lastAttempt = now();
    nextRefresh = now() + 120000;
    try {
      const session = await bounded(() => portal.getSession());
      if (stopped) return;
      const owner = Object.values(session?.members || {}).find(m =>
        String(m?.constants?.system?.xuid) === String(host.profile?.xuid));
      if (!owner || !host.connectionId) return restart('Published session lost its host');
      // Republish the joinable world card as well as the activity handle.
      // Never overwrite nonces while an Xbox join event is updating them.
      const body = portal.createSessionBody();
      delete body.properties.custom.nonces;
      await bounded(() => portal.updateSession({
        properties: body.properties,
        members: { me: { properties: body.members.me.properties } },
      }));
      if (stopped) return;
      await bounded(() => host.rest.setActivity(portal.session.name));
      if (stopped) return;
      await bounded(() => host.rest.setPresence(host.profile.xuid));
      if (stopped) return;
      state.failures = 0; state.status = 'published';
      state.lastRefresh = new Date(now()).toISOString();
      log('[WORLD HEALTH] Session activity and presence refreshed');
    } catch (e) {
      if (stopped) return;
      const message = String(e?.message || e);
      state.status = 'degraded';
      // A throttle is not evidence of an expired session. Do not restart-loop.
      if (/429/.test(message)) {
        const period = Number(message.match(/"periodInSeconds"\s*:\s*(\d+)/)?.[1] || 300);
        rateUntil = now() + Math.max(310000, period * 1000 + 10000);
        nextRefresh = rateUntil;
        log('[WORLD HEALTH] Rate limited; pausing refresh');
      } else if (/WORLD_REQUEST_TIMEOUT|\b404\b|\b410\b/.test(message)) {
        restart('Session missing or renewal timed out');
      } else {
        state.failures++;
        log('[WORLD HEALTH] Refresh failed (' + state.failures + '/3)');
        if (state.failures >= 3) restart('Session renewal failed three times');
      }
    } finally { busy = false; }
  }
  // Debounce join/leave notifications; at most one publication per minute.
  // A player leaving never closes/restarts the host world.
  function requestRefresh() {
    if (stopped) return;
    nextRefresh = Math.min(nextRefresh, Math.max(now() + 5000, lastAttempt + 60000));
  }
  function start() {
    if (timer || stopped) return;
    timer = interval(() => { void check(); }, 15000);
    void check();
  }
  function stop() { stopped = true; if (timer) cancel(timer); timer = null; }
  return { state, start, stop, check, requestRefresh };
}
module.exports = { createWorldHealth };
