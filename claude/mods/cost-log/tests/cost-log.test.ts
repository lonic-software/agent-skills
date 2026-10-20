import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__cost-log__cost_log' as const
const MIN = 60_000

type Usage = { in: number; rd: number; wr: number; out: number }
const usage = (u: Usage, model = 'claude-opus-5-5') => ({
  input_tokens: u.in,
  cache_read_input_tokens: u.rd,
  cache_creation_input_tokens: u.wr,
  output_tokens: u.out,
  model,
})

type On = Parameters<Parameters<typeof test>[1]>[1]

// The usage the next stubbed request answers with; set by turn() before each step.
let answer: Usage = { in: 0, rd: 0, wr: 0, out: 0 }

// The session id the stub answers; a test switches it to stand for /clear.
let session = 'sess-0001-abcd'
// How long each stubbed request streams before answering.
let streamMs = 0
// When set, the stubbed request answers with no usage (a failed request).
let nullUsage = false

function world(on: On, opts: { brokenStore?: boolean } = {}) {
  session = 'sess-0001-abcd'
  const clock = mock.clock(on)
  streamMs = 0
  on('turn.step', async function* (_$, e) {
    if (streamMs) await clock.set(clock.now() + streamMs)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: nullUsage ? null : usage(answer) } as never
  })
  if (!opts.brokenStore) mock.store(on)
  else {
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => {
      throw new Error('store over 4 MiB')
    })
  }
  on('session.id', () => ({ value: session }))
  on('agent.list', () => ({ value: [{ id: 'agent-x1', type: 'Explore', description: 'find callers' }] as never }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

// One turn of `reqs` requests, each answering with `u`, ending at the clock's time.
async function turn($: Parameters<Parameters<typeof test>[1]>[0], _on: On, id: string, reqs: Usage[], agentId?: string, first = 0) {
  for (const [i, u] of reqs.entries()) {
    const index = first + i
    answer = u
    const stream = $.turn.step({ turnId: id, index, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of stream as AsyncIterable<unknown>) void _
  }
  const total = reqs.reduce((a, u) => ({ in: a.in + u.in, rd: a.rd + u.rd, wr: a.wr + u.wr, out: a.out + u.out }))
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: id,
    reason: 'answer',
    usage: usage(total),
    ...(agentId ? { agentId } : {}),
  })
}

const text = async ($: Parameters<Parameters<typeof test>[1]>[0], turns?: number) => {
  const ran = await $.tool.call({ tool: TOOL, ...(turns ? { turns } : {}) } as never)
  expect(typeof ran.result).toBe('string')
  return ran.result as unknown as string
}

test('an empty session says so', async ($, on) => {
  world(on)
  expect(await text($)).toContain('no turns recorded')
})

test('totals by agent use the weights', async ($, on) => {
  world(on)
  // main: 1000 input + 100k read*0.1 + 10k write*2 + 1000 out*5 = 1000+10000+20000+5000 = 36k
  await turn($, on, 't1', [{ in: 1000, rd: 100_000, wr: 10_000, out: 1000 }])
  // subagent: 10k write*1.25 = 12.5k
  await turn($, on, 's1', [{ in: 0, rd: 0, wr: 10_000, out: 0 }], 'agent-x1')
  const out = await text($)
  expect(out).toContain('2 turns (1 main, 1 subagent)')
  expect(out).toMatch(/^main\s+1\s+1\s+1\.0k\s+100k\s+10k\s+1\.0k\s+36k\s+74%/m)
  expect(out).toMatch(/^agent-x1 Explore "find callers"\s+1\s+1\s+0\s+0\s+10k\s+0\s+13k\s+26%/m)
  expect(out).toMatch(/^all\s+2\s+2 .*49k\s+100%/m)
})

test('a main turn over 25k per request is flagged, one under is not', async ($, on) => {
  const clock = world(on)
  // two requests: per-request cost (2*30k)/2 = 30k > 25k
  await turn($, on, 't1', [{ in: 0, rd: 300_000, wr: 0, out: 0 }, { in: 0, rd: 300_000, wr: 0, out: 0 }])
  await clock.advance(MIN)
  // 200k read -> 20k per request, under target
  await turn($, on, 't2', [{ in: 0, rd: 200_000, wr: 0, out: 0 }])
  const out = await text($)
  expect(out).toContain('over 25k per request: 1 of 2')
  expect(out).toMatch(/context 300k {2}2 reqs {2}30k\/req \(re-read 30k\/req\)/)
})

test('a large write after a subagent gap past 5 minutes is a rebuild', async ($, on) => {
  const clock = world(on)
  await turn($, on, 's1', [{ in: 0, rd: 0, wr: 80_000, out: 100 }], 'agent-x1') // spawn: no previous request
  await clock.advance(7 * MIN)
  await turn($, on, 's2', [{ in: 10, rd: 0, wr: 90_000, out: 100 }], 'agent-x1')
  const out = await text($)
  expect(out).toContain('Cache rebuilds (large write after a gap past the TTL): 1')
  expect(out).toMatch(/gap 7m, wrote 90k \(cost-eq 113k\)/)
})

test('a warm resume and a main-thread gap under an hour are not rebuilds', async ($, on) => {
  const clock = world(on)
  await turn($, on, 's1', [{ in: 0, rd: 0, wr: 80_000, out: 0 }], 'agent-x1')
  await clock.advance(4 * MIN)
  await turn($, on, 's2', [{ in: 0, rd: 0, wr: 80_000, out: 0 }], 'agent-x1')
  await turn($, on, 't1', [{ in: 0, rd: 0, wr: 50_000, out: 0 }])
  await clock.advance(30 * MIN)
  await turn($, on, 't2', [{ in: 0, rd: 0, wr: 50_000, out: 0 }])
  await clock.advance(61 * MIN)
  // after the hour, but the write is a small share of the prompt: cache held
  await turn($, on, 't3', [{ in: 0, rd: 200_000, wr: 15_000, out: 0 }])
  expect(await text($)).toContain('gap past the TTL): 0')
})

test('a main-thread write after an hour is a rebuild', async ($, on) => {
  const clock = world(on)
  await turn($, on, 't1', [{ in: 0, rd: 0, wr: 50_000, out: 0 }])
  await clock.advance(61 * MIN)
  await turn($, on, 't2', [{ in: 0, rd: 0, wr: 60_000, out: 0 }])
  expect(await text($)).toMatch(/gap 61m, wrote 60k \(cost-eq 120k\)/)
})

test('/cost-log answers with the same report and lists recent turns', async ($, on) => {
  world(on)
  for (const id of ['t1', 't2', 't3']) await turn($, on, id, [{ in: 1, rd: 0, wr: 0, out: 1 }])
  const ran = await $.command.run({ command: 'cost-log', args: '2' })
  expect(ran.text).toContain('3 turns (3 main, 0 subagent)')
  expect(ran.text).toContain('Last 2')
})

test('parallel subagent turns finishing together are all kept', async ($, on) => {
  world(on)
  const u = usage({ in: 1, rd: 0, wr: 0, out: 1 })
  const done = (turnId: string, agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer', usage: u, agentId })
  await Promise.all(['a1', 'a2', 'a3', 'a4', 'a5'].map(a => done(`t-${a}`, a)))
  expect(await text($)).toContain('5 turns (0 main, 5 subagent)')
})

test('only the ten most recent sessions are kept', async ($, on) => {
  const clock = world(on)
  for (let i = 1; i <= 11; i++) {
    session = `sess-${String(i).padStart(4, '0')}`
    await turn($, on, `t${i}`, [{ in: 1, rd: 0, wr: 0, out: 1 }])
    await clock.advance(10 * MIN)
  }
  expect(await text($)).toContain('1 turns (1 main')
  session = 'sess-0002'
  expect(await text($)).toContain('1 turns (1 main')
  session = 'sess-0001'
  expect(await text($)).toContain('no turns recorded')
})

test('a gap is not carried across sessions', async ($, on) => {
  const clock = world(on)
  await turn($, on, 't1', [{ in: 0, rd: 0, wr: 50_000, out: 0 }])
  await clock.advance(65 * MIN)
  session = 'sess-0002-after-clear'
  await turn($, on, 't2', [{ in: 0, rd: 0, wr: 50_000, out: 0 }])
  expect(await text($)).toContain('gap past the TTL): 0')
})

test('the gap excludes the request\'s own streaming time', async ($, on) => {
  const clock = world(on)
  await turn($, on, 's1', [{ in: 0, rd: 0, wr: 50_000, out: 0 }], 'agent-x1')
  await clock.advance(4 * MIN)
  // sent after 4m idle (under the TTL), then streams for 2m
  streamMs = 2 * MIN
  await turn($, on, 's2', [{ in: 0, rd: 40_000, wr: 60_000, out: 0 }], 'agent-x1')
  expect(await text($)).toContain('gap past the TTL): 0')
})

test('a turn whose requests were not seen is kept but not flagged per request', async ($, on) => {
  world(on)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'unseen',
    reason: 'answer',
    usage: usage({ in: 0, rd: 900_000, wr: 0, out: 0 }),
  })
  const out = await text($)
  expect(out).toContain('1 turns (1 main')
  expect(out).toContain('over 25k per request: 0 of 0 (1 more not judged')
})

test('an aborted turn without usage leaves nothing behind for the next turn', async ($, on) => {
  world(on)
  answer = { in: 0, rd: 100_000, wr: 0, out: 0 }
  for await (const _ of $.turn.step({ turnId: 'x', index: 0, model: 'm', messageCount: 1 }) as AsyncIterable<unknown>) void _
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'x', reason: 'aborted' })
  await turn($, on, 'x', [{ in: 0, rd: 300_000, wr: 0, out: 0 }])
  expect(await text($)).toMatch(/context 300k {2}1 reqs {2}30k\/req/)
})

test('a refused store write is reported, not swallowed', async ($, on) => {
  world(on, { brokenStore: true })
  await turn($, on, 't1', [{ in: 1, rd: 0, wr: 0, out: 1 }])
  expect(await text($)).toContain('The last turn was not recorded: ')
})

test('a turn first seen past its first request is not judged per request', async ($, on) => {
  const clockOf = world(on)
  await turn($, on, 't0', [{ in: 1, rd: 0, wr: 0, out: 1 }])
  await clockOf.advance(61 * MIN) // a stale baseline must not read as a rebuild either
  answer = { in: 0, rd: 0, wr: 300_000, out: 0 }
  for await (const _ of $.turn.step({ turnId: 'r', index: 6, model: 'm', messageCount: 1 }) as AsyncIterable<unknown>) void _
  await $.turn.complete({
    answer: '', durationMs: 1, isAborted: false, turnId: 'r', reason: 'answer',
    usage: usage({ in: 0, rd: 2_100_000, wr: 300_000, out: 0 }),
  })
  const out = await text($)
  expect(out).toContain('over 25k per request: 0 of 1 (1 more not judged')
  expect(out).toContain('gap past the TTL): 0')
})

test('an error in one session does not show in another', async ($, on) => {
  world(on, { brokenStore: true })
  await turn($, on, 't1', [{ in: 1, rd: 0, wr: 0, out: 1 }])
  session = 'sess-0002-after-clear'
  expect(await text($)).not.toContain('not recorded')
})

test('a first request without usage does not make the turn partial', async ($, on) => {
  world(on)
  nullUsage = true
  for await (const _ of $.turn.step({ turnId: 'f', index: 0, model: 'm', messageCount: 1 }) as AsyncIterable<unknown>) void _
  nullUsage = false
  await turn($, on, 'f', [{ in: 0, rd: 600_000, wr: 0, out: 0 }], undefined, 1)
  expect(await text($)).toContain('over 25k per request: 1 of 1')
})

test('a session written within the hour is not evicted', async ($, on) => {
  const clock = world(on)
  for (let i = 1; i <= 11; i++) {
    session = `sess-${String(i).padStart(4, '0')}`
    await turn($, on, `t${i}`, [{ in: 1, rd: 0, wr: 0, out: 1 }])
    await clock.advance(MIN)
  }
  session = 'sess-0001'
  expect(await text($)).toContain('1 turns (1 main')
})

test('after a reload mid-turn, later requests of the turn are checked for rebuilds', async ($, on) => {
  const clock = world(on)
  await turn($, on, 's0', [{ in: 1, rd: 0, wr: 0, out: 1 }], 'agent-x1')
  await clock.advance(20 * MIN)
  answer = { in: 0, rd: 80_000, wr: 1_000, out: 0 } // first step seen after the reload: no baseline
  for await (const _ of $.turn.step({ turnId: 's1', index: 3, model: 'm', messageCount: 1, agentId: 'agent-x1' }) as AsyncIterable<unknown>) void _
  await clock.advance(7 * MIN)
  answer = { in: 0, rd: 10_000, wr: 80_000, out: 0 }
  for await (const _ of $.turn.step({ turnId: 's1', index: 4, model: 'm', messageCount: 1, agentId: 'agent-x1' }) as AsyncIterable<unknown>) void _
  await $.turn.complete({
    answer: '', durationMs: 1, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'agent-x1',
    usage: usage({ in: 0, rd: 90_000, wr: 81_000, out: 0 }),
  })
  expect(await text($)).toMatch(/gap 7m, wrote 80k/)
})
