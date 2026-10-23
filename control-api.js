'use strict';
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
function startApi(invites, { key = process.env.MC_API_KEY, port = Number(process.env.PORT || 3000) } = {}) {
  if (!key) console.warn('[API] MC_API_KEY missing: Discord control disabled');
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const actual = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + (key || ''));
    if (!key || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(401, { error: 'Unauthorized: check MC_API_KEY on both services' });
    if (req.method === 'GET' && req.url === '/status') return reply(200, invites.state);
    if (req.method === 'POST' && req.url === '/invite-all') {
      try { return reply(202, { batch: invites.inviteAll() }); }
      catch(e) { return reply(409, { error: e.message }); }
    }
    reply(404, { error: 'Not found' });
  });
  server.listen(port, '::'); return server;
}
module.exports = { startApi };
