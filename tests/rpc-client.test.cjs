'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { rpc } = require('../codex/runtime/rpc-client.cjs');
const script =
  "const rl=require('readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({id:m.id,method:'EXAMPLE-operator',params:{question:'EXAMPLE decision'}}));else console.log(JSON.stringify({id:m.id,result:{initialized:true,operatorResponse:m.result||m.error}}))})";
test('server request IDs cannot collide with pending client call IDs', async () => {
  const c = rpc(process.execPath, ['-e', script], {
    onRequest: async (r) => {
      assert.equal(r.params.question, 'EXAMPLE decision');
      return { decision: 'decline' };
    },
  });
  try {
    const result = await c.call('initialize');
    assert.equal(result.initialized, true);
    assert.equal(result.operatorResponse.decision, 'decline');
  } finally {
    c.close();
  }
});
test('a client without an operator rejects server requests explicitly', async () => {
  const c = rpc(process.execPath, ['-e', script]);
  try {
    const result = await c.call('initialize');
    assert.equal(result.initialized, true);
    assert.equal(result.operatorResponse.code, -32601);
  } finally {
    c.close();
  }
});

for (const character of ['\u00e1', '\ud83d\ude00'])
  test('stdout preserves a split UTF-8 character ' + character, async () => {
    const expected = 'EXAMPLE ' + character + ' \u0151\u0171',
      child = `const rl=require('readline').createInterface({input:process.stdin});let rest;rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='split'){const bytes=Buffer.from(JSON.stringify({id:m.id,result:${JSON.stringify(expected)}})+'\\n');const cut=bytes.indexOf(Buffer.from(${JSON.stringify(character)}))+1;rest=bytes.subarray(cut);process.stdout.write(Buffer.concat([Buffer.from(JSON.stringify({method:'ready'})+'\\n'),bytes.subarray(0,cut)]));}else if(m.method==='next')process.stdout.write(rest);});`;
    const c = rpc(process.execPath, ['-e', child], {
      onMessage: (m) => {
        if (m.method === 'ready') c.notify('next');
      },
    });
    try {
      assert.equal(await c.call('split'), expected);
    } finally {
      c.close();
    }
  });
test('stderr callbacks and exit diagnostics preserve split UTF-8', async () => {
  const child =
    "const rl=require('readline').createInterface({input:process.stdin});let rest;rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='split'){const b=Buffer.from('EXAMPLE \\u0151\\u0171');const cut=b.indexOf(Buffer.from('\\u0151'))+1;rest=b.subarray(cut);process.stderr.write(b.subarray(0,cut));}else if(m.method==='next'){process.stderr.write(rest,()=>process.exit(7));}});";
  let stderr = '',
    sent = false;
  const c = rpc(process.execPath, ['-e', child], {
    onStderr: (text) => {
      stderr += text;
      if (!sent) {
        sent = true;
        c.notify('next');
      }
    },
  });
  try {
    await assert.rejects(
      c.call('split'),
      /Process exited 7: EXAMPLE \u0151\u0171/,
    );
    assert.equal(stderr, 'EXAMPLE \u0151\u0171');
  } finally {
    c.close();
  }
});
