'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {captureResult, verifyResult} = require('../codex/runtime/managed-result.cjs');
test('result byte substitution fails even at identical length', () => {
  const original = Buffer.from('original'), substituted = Buffer.from('replaced');
  const delivery = captureResult(original);
  assert.throws(() => delivery.consume(substituted), /MANAGED_RESULT_BYTES_CHANGED/);
});
test('receipt covers actual accepted buffer and rejects later mutation or truncation', () => {
  const delivery = captureResult(Buffer.from('original')), accepted = delivery.consume();
  assert.equal(accepted.receipt.length, 8); assert.equal(verifyResult(accepted.bytes, accepted.receipt), true);
  accepted.bytes[0] ^= 1;
  assert.throws(() => verifyResult(accepted.bytes, accepted.receipt), /MANAGED_RESULT_BYTES_CHANGED/);
  assert.throws(() => verifyResult(accepted.bytes.subarray(1), accepted.receipt), /MANAGED_RESULT_BYTES_CHANGED/);
  assert.throws(() => delivery.consume(), /ALREADY_CONSUMED/);
});
test('source buffer and replacement pathname never replace captured result authority', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-result-'));
  try {
    const file = path.join(dir, 'out.json'); fs.writeFileSync(file, 'original');
    const source = fs.readFileSync(file), delivery = captureResult(source);
    source.fill(0); fs.writeFileSync(file, 'replaced');
    const accepted = delivery.consume(); assert.equal(accepted.bytes.toString(), 'original');
    assert.equal(verifyResult(accepted.bytes, accepted.receipt), true);
    assert.throws(() => verifyResult(fs.readFileSync(file), accepted.receipt), /MANAGED_RESULT_BYTES_CHANGED/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
