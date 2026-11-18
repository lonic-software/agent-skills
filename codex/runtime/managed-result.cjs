'use strict';
const { createHash } = require('node:crypto');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function describe(bytes) {
  if (!Buffer.isBuffer(bytes)) throw Error('MANAGED_RESULT_BUFFER_REQUIRED');
  return Object.freeze({ length: bytes.length, sha256: digest(bytes) });
}
function verifyResult(bytes, receipt) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== receipt?.length ||
    digest(bytes) !== receipt?.sha256
  )
    throw Error('MANAGED_RESULT_BYTES_CHANGED'); // RESULT_BYTES_GUARD
  return true;
}
function captureResult(bytes) {
  // The caller's mutable buffer/path is not retained as authority.
  describe(bytes);
  const captured = Buffer.from(bytes),
    receipt = describe(captured);
  let spent = false,
    consumed = null;
  return Object.freeze({
    receipt,
    consumed: () => consumed,
    consume(candidate = Buffer.from(captured)) {
      if (spent) throw Error('MANAGED_RESULT_ALREADY_CONSUMED');
      spent = true;
      if (!Buffer.isBuffer(candidate))
        throw Error('MANAGED_RESULT_BUFFER_REQUIRED');
      // Copy and validate the ACTUAL supplied delivery bytes synchronously.
      // There is no await or pathname reopen between validation and acceptance.
      const accepted = Buffer.from(candidate);
      verifyResult(accepted, receipt);
      consumed = Object.freeze({ bytes: accepted, receipt });
      return consumed;
    },
  });
}
module.exports = { captureResult, verifyResult, describe };
