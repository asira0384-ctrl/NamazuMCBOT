'use strict';
const assert = require('node:assert/strict');
const { netherRequire } = require('./protocol-compat');
const { createSerializer, createDeserializer, createProtocol } = netherRequire('./transforms/serializer');
const { defaultOptions } = netherRequire('./options');
assert.equal(defaultOptions.version, '1.26.60');
assert.equal(defaultOptions.protocolVersion, 2225);
const serializer = createSerializer('1.26.60');
const parser = createDeserializer('1.26.60');
let packets = 0;
function roundtrip(name, params) {
  const buffer = serializer.createPacketBuffer({name, params});
  const decoded = parser.parsePacketBuffer(buffer);
  assert.equal(decoded.data.name, name);
  assert.deepEqual(serializer.createPacketBuffer(decoded.data), buffer);
  packets++;
}
roundtrip('transfer', {server_address:'namazusmp.mcxs.jp',port:19132,reload_world:false,gatherings_configuration:undefined});
roundtrip('resource_packs_info', {must_accept:false,has_addons:false,has_scripts:false,disable_vibrant_visuals:false,world_template:{uuid:'',version:''},texture_packs:[]});
roundtrip('resource_pack_stack', {must_accept:false,resource_packs:[],game_version:'*',experiments:[],experiments_previously_used:false,has_editor_packs:false});
require('bedrock-portal/dist/common/start_game').sendStartGame({write: roundtrip});
console.log(`PASS: 26.60 codec compiles; ${packets} join/transfer packets round-trip`);
if (process.argv.includes('--server')) {
  const { BedrockPortal } = require('bedrock-portal');
  const portal = new BedrockPortal({ip:'namazusmp.mcxs.jp',port:19132});
  assert.equal(portal.server.options.protocolVersion,2225);
  console.log('PASS: actual BedrockPortal constructor (no login or invitations)');
}
