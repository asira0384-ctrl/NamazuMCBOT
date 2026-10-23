const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createInvites } = require('./invites');
const { startApi } = require('./control-api');
(async () => {
 let requests=[], sent=[], fail=false, time=100000;
 const rta=new EventEmitter();rta.subscribe=async()=>{};
 const portal={host:{rta,profile:{xuid:'999'},rest:{
  getFriendRequestsReceived:async()=>requests,
  acceptFriendRequests:async ids=>{requests=[];return {updatedPeople:ids}},
  getXboxFollowers:async()=>[],getXboxFriends:async()=>[{xuid:'111',gamertag:'existing'}]
 }},invitePlayer:async id=>{if(fail)throw Error('403 test');sent.push(id)}};
 const engine=createInvites(portal,{sleep:async()=>{},log:()=>{},now:()=>time});
 await engine.start();assert.deepEqual(sent,[],'startup must not invite existing friends');
 requests=[{xuid:'222',gamertag:'new'}];await engine.sync();await engine.drained();
 assert.deepEqual(sent,['222'],'invite accepted XUID without waiting for friends-list propagation');
 engine.onAccepted({xuid:'222'});await engine.drained();assert.equal(sent.length,1);
 fail=true;time+=61000;engine.onAccepted({xuid:'333'});await new Promise(r=>setImmediate(r));await engine.drained();assert.match(engine.state.lastError,/403/);
 fail=false;engine.inviteAll();await new Promise(r=>setImmediate(r));await engine.drained();assert.equal(engine.state.batch.sent,1);assert.deepEqual(sent,['222','111']);
 assert.throws(()=>engine.inviteAll(),/60 seconds/);
 const api=startApi(engine,{key:'test-secret',port:0});await new Promise(r=>api.once('listening',r));
 const base='http://localhost:'+api.address().port;
 assert.equal((await fetch(base+'/invite-all',{method:'POST'})).status,401);
 assert.equal((await fetch(base+'/status',{headers:{Authorization:'Bearer test-secret'}})).status,200);
 await new Promise(r=>api.close(r));engine.stop();
 console.log('PASS: no startup invites, direct accepted-XUID invite, dedup, failure logging, manual batch, cooldown, API auth');
})().catch(e=>{console.error(e);process.exitCode=1});
