'use strict';
const assert = require('node:assert/strict');
const { createWorldHealth } = require('./world-health');
function setup() {
  let time = 0, recovery = 0, calls = [];
  const portal = {
    session: { name: 'session', pmsgId: 'p' },
    host: { profile: { xuid: '123' }, connectionId: 'c', rta: { ws: { readyState: 1 } }, rest: {} },
    server: { signaling: { pmsgId: 'p', ws: { readyState: 1 } } },
    getSession: async () => ({ members: { me: { constants: { system: { xuid: '123' } } } } }),
    updateSession: async body => calls.push(body),
    invitePlayer: () => { throw Error('Health checks must never invite'); },
  };
  for (const name of ['setPresence', 'setActivity', 'updateConnection']) portal.host.rest[name] = async () => calls.push(name);
  const health = createWorldHealth(portal, { now: () => time, recover: () => recovery++, log: () => {}, timeoutMs: 10 });
  return { portal, health, calls, advance: ms => time += ms, recoveries: () => recovery };
}
(async () => {
  let x = setup(); await x.health.check(); assert.equal(x.health.state.status, 'published');
  assert.equal(x.calls.length, 3); await x.health.check(); assert.equal(x.calls.length, 3);
  x.advance(120000); await x.health.check(); assert.equal(x.calls.length, 6);
  x.portal.server.signaling.ws.readyState = 3; await x.health.check(); assert.equal(x.recoveries(), 0);
  x.advance(60000); await x.health.check(); await x.health.check(); assert.equal(x.recoveries(), 1);
  x = setup(); x.portal.server.signaling.pmsgId = 'changed'; await x.health.check(); assert.equal(x.recoveries(), 1);
  x = setup(); x.portal.getSession = async () => ({ members: {} }); await x.health.check(); assert.equal(x.recoveries(), 1);
  x = setup(); x.portal.getSession = async () => { throw Error('404 Not Found'); }; await x.health.check(); assert.equal(x.recoveries(), 1);
  x = setup(); x.portal.getSession = async () => { throw Error('429 {"periodInSeconds":300}'); };
  await x.health.check(); x.portal.getSession = async () => { throw Error('Should not retry yet'); };
  x.advance(300000); await x.health.check(); assert.equal(x.health.state.failures, 0); assert.equal(x.recoveries(), 0);
  x.advance(10001); await x.health.check(); assert.equal(x.health.state.failures, 1);
  x = setup(); x.portal.getSession = async () => { throw Error('503'); };
  for (let i = 0; i < 3; i++) { await x.health.check(); x.advance(120000); } assert.equal(x.recoveries(), 1);
  x = setup(); x.portal.getSession = () => new Promise(() => {}); await x.health.check(); assert.equal(x.recoveries(), 1);
  x = setup(); let resolve; x.portal.getSession = () => new Promise(r => { resolve = r; });
  const pending = x.health.check(); await Promise.resolve(); await x.health.check(); x.health.stop(); resolve({ members: {} });
  await pending; assert.equal(x.recoveries(), 0); assert.equal(x.calls.length, 0);
  x = setup(); x.portal.getSession = async () => ({ members: { me: { constants: { system: { xuid: '123' } } } }, properties: { system: { closed: true } } });
  await x.health.check(); assert.deepEqual(x.calls[0], { properties: { system: { closed: false } } });
  console.log('PASS: renewal, cadence, socket grace, identity change, missing host/session, throttle, repeated failures, timeout, stop/concurrency, reopening; no invites');
})();
