'use strict';
// Missing ProtoDef handlers in bedrock-portal-nethernet 2.8.0.
// Semantics follow PrismarineJS/bedrock-protocol's compiler-minecraft.js.
// Register before constructing a Server; keep the real 26.60 packet schema.
const { createRequire } = require('node:module');
const portalRequire = createRequire(require.resolve('bedrock-portal'));
const netherRequire = createRequire(portalRequire.resolve('bedrock-portal-nethernet'));
const { Read, Write, SizeOf } = netherRequire('./datatypes/compiler-minecraft');

Read.maybeIncompleteArray ??= ['parametrizable', (c, { countType, type }) => c.wrapCode(`
  const countResult = ${c.callType(countType)}
  const count = countResult.value
  if (count > 0xffffff && !ctx.noArraySizeCheck) throw new Error('Array too large: ' + count)
  const value = []
  let size = countResult.size
  for (let i = 0; i < count && offset + size < buffer.length; i++) {
    try {
      const item = ${c.callType(type, 'offset + size')}
      value.push(item.value)
      size += item.size
    } catch (error) {
      if (error.name !== 'PartialReadError') throw error
      break
    }
  }
  return { value, size }
`)];
Write.maybeIncompleteArray ??= ['parametrizable', (c, { countType, type }) => c.wrapCode(`
  offset = ${c.callType('value.length', countType)}
  for (let i = 0; i < value.length; i++) offset = ${c.callType('value[i]', type)}
  return offset
`)];
SizeOf.maybeIncompleteArray ??= ['parametrizable', (c, { countType, type }) => c.wrapCode(`
  let size = ${c.callType('value.length', countType)}
  for (let i = 0; i < value.length; i++) size += ${c.callType('value[i]', type)}
  return size
`)];
Read.optionalOnRemaining ??= ['parametrizable', (c, { type }) => c.wrapCode(`
  if (offset >= buffer.length) return { value: undefined, size: 0 }
  return ${c.callType(type)}
`)];
Write.optionalOnRemaining ??= ['parametrizable', (c, { type }) => c.wrapCode(`
  if (value === undefined) return offset
  return ${c.callType('value', type)}
`)];
SizeOf.optionalOnRemaining ??= ['parametrizable', (c, { type }) => c.wrapCode(`
  if (value === undefined) return 0
  return ${c.callType('value', type)}
`)];
module.exports = { netherRequire };
