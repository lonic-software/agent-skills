import type { EngineInterface, Register, TurnUsage } from 'claude-code'

const TOOL = 'mcp__cost-log__cost_log'

// Cost-equivalent weights, in base-input tokens (agent-cost-model-measured):
// cache read 0.1x, output 5x; a cache write is 2x on the main thread (1-hour
// cache) and 1.25x in a subagent (5-minute default).
const W = { input: 1, read: 0.1, out: 5, writeMain: 2, writeSub: 1.25 }
const TTL_MS = { main: 60 * 60_000, sub: 5 * 60_000 }
// Per-request cost-equivalent the main thread should stay under.
const TARGET = 25_000
// A write counts as a rebuild when it follows a gap past the cache TTL, is at
// least this big, and is most of the request's prompt.
const REBUILD_MIN = 10_000
// A turn is ~190 bytes of JSON: 10 sessions of 1200 turns stay near 2.3 MB,
// under the store's 4 MiB, so the cap is never what limits recording.
const MAX_SESSIONS = 10
const MAX_TURNS = 1200

/** One turn, kept short: the store holds 4 MiB across every session. */
type Turn = {
  t: number // end, ms
  a?: string // agentId; absent on the main thread
  m: string
  in: number
  rd: number
  wr: number
  out: number
  ctx: number // the last request's prompt: input + cache read + cache write
  n: number // requests in the turn
  peak: number // costliest request, cost-equivalent
  rb?: { gap: number; wr: number } // cache rebuild: gap in ms, tokens written
  p?: 1 // partial: the turn's requests were not all seen (a reload mid-turn), so `n` is a floor
}
type Session = { turns: Turn[]; dropped: number; agents: Record<string, string> }

type Step = { n: number; peak: number; ctx: number; partial: boolean; based: boolean; rb?: { gap: number; wr: number } }

// Requests of turns still running, each loop's last request end (null: none
// found), and agent labels, keyed by session then loop. Module memory: a
// reload starts them over, the store keeps the turns.
const steps = new Map<string, Step>()
const lastAt = new Map<string, number | null>()
const labels = new Map<string, string | null>()
const lastError = new Map<string, string>() // by session

let chain: Promise<unknown> = Promise.resolve()

// Store writes from parallel subagents would race on read-modify-write.
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => undefined)
  return p
}

const loop = (agentId?: string) => agentId ?? 'main'
const writeWeight = (agentId?: string) => (agentId === undefined ? W.writeMain : W.writeSub)

function cost(u: { in: number; rd: number; wr: number; out: number }, agentId?: string) {
  return u.in * W.input + u.rd * W.read + u.wr * writeWeight(agentId) + u.out * W.out
}

function counts(u: TurnUsage) {
  return {
    in: u.input_tokens,
    rd: u.cache_read_input_tokens,
    wr: u.cache_creation_input_tokens,
    out: u.output_tokens,
  }
}

async function loadSession($: EngineInterface, id: string): Promise<Session> {
  const s = (await $.store.get(`s:${id}`)) as Session | undefined
  return s ?? { turns: [], dropped: 0, agents: {} }
}

// When this loop last made a request: memory, else (once per module life) its
// last stored turn, which is what carries the gap across a reload.
async function previousEnd($: EngineInterface, sid: string, agentId?: string) {
  const key = `${sid}|${loop(agentId)}`
  const known = lastAt.get(key)
  if (known !== undefined) return known ?? undefined
  const s = await loadSession($, sid)
  let prev: number | undefined
  for (let i = s.turns.length - 1; i >= 0 && prev === undefined; i--) {
    if (s.turns[i]!.a === agentId) prev = s.turns[i]!.t
  }
  lastAt.set(key, prev ?? null)
  return prev
}

async function agentLabel($: EngineInterface, agentId: string, retryMiss = false) {
  if (labels.has(agentId) && !(retryMiss && labels.get(agentId) === null)) return labels.get(agentId) ?? undefined
  const info = await $.agent.list().then(
    list => list.find(a => a.id === agentId),
    () => undefined,
  )
  const label = info ? `${info.type} "${info.description.slice(0, 60)}"` : null
  labels.set(agentId, label)
  return label ?? undefined
}

// One request of a turn: `start` is when it was sent, so the gap the cache sat
// idle excludes the request's own streaming.
async function noteStep(
  $: EngineInterface,
  turnId: string,
  index: number,
  agentId: string | undefined,
  start: number,
  u: TurnUsage | null,
) {
  const sid = await $.session.id()
  const key = `${sid}|${loop(agentId)}|${turnId}`
  // A turn first seen past its first request (a reload mid-turn) has an `n`
  // that is only a floor, and its first request has no gap baseline.
  const step = steps.get(key) ?? { n: 0, peak: 0, ctx: 0, partial: index > 0, based: index === 0 }
  steps.set(key, step)
  if (!u) return
  const prev = await previousEnd($, sid, agentId)
  lastAt.set(`${sid}|${loop(agentId)}`, await $.clock.now())
  if (agentId !== undefined && index === 0) await agentLabel($, agentId)

  const c = counts(u)
  const prompt = c.in + c.rd + c.wr
  step.n += 1
  step.ctx = prompt
  step.peak = Math.max(step.peak, Math.round(cost(c, agentId)))
  const gap = prev === undefined ? 0 : start - prev
  const ttl = agentId === undefined ? TTL_MS.main : TTL_MS.sub
  const based = step.based
  step.based = true
  if (based && prev !== undefined && gap > ttl && c.wr >= REBUILD_MIN && c.wr >= prompt / 2) {
    if (!step.rb || c.wr > step.rb.wr) step.rb = { gap: Math.round(gap), wr: c.wr }
  }
}

// Keeps the MAX_SESSIONS most recently written sessions. Sessions are read
// from the store's keys, not an index of our own that a second Claude Code
// process could overwrite; the check runs on a session's first turn only and
// spares any session written within the hour, which may be live elsewhere.
async function evictOld($: EngineInterface, current: string) {
  const ids = (await $.store.keys()).filter(k => k.startsWith('s:') && k !== `s:${current}`)
  if (ids.length < MAX_SESSIONS) return
  const ages: [string, number][] = []
  for (const k of ids) {
    const s = (await $.store.get(k)) as Session | undefined
    ages.push([k, s?.turns[s.turns.length - 1]?.t ?? 0])
  }
  ages.sort((x, y) => x[1] - y[1])
  const idleBefore = (await $.clock.now()) - TTL_MS.main
  const old = ages.slice(0, ids.length - MAX_SESSIONS + 1).filter(([, t]) => t < idleBefore)
  for (const [k] of old) await $.store.delete(k)
}

async function recordTurn($: EngineInterface, turnId: string, agentId: string | undefined, u: TurnUsage) {
  const sid = await $.session.id()
  const step = steps.get(`${sid}|${loop(agentId)}|${turnId}`)
  const c = counts(u)
  const now = await $.clock.now()
  lastAt.set(`${sid}|${loop(agentId)}`, now)
  const turn: Turn = {
    t: now,
    ...(agentId === undefined ? {} : { a: agentId }),
    m: u.model,
    ...c,
    ctx: step?.ctx ?? c.in + c.rd + c.wr,
    n: step?.n ?? 1,
    peak: step?.peak ?? Math.round(cost(c, agentId)),
    ...(step?.rb ? { rb: step.rb } : {}),
    ...(step === undefined || step.partial ? { p: 1 as const } : {}),
  }
  const label = agentId === undefined ? undefined : await agentLabel($, agentId, true)

  await serial(async () => {
    const s = await loadSession($, sid)
    if (s.turns.length === 0) await evictOld($, sid)
    if (agentId !== undefined && label !== undefined) s.agents[agentId] = label
    s.turns.push(turn)
    if (s.turns.length > MAX_TURNS) {
      s.dropped += s.turns.length - MAX_TURNS
      s.turns = s.turns.slice(-MAX_TURNS)
    }
    try {
      await $.store.set(`s:${sid}`, s)
    } catch (err) {
      if (!/MiB/.test(String(err))) throw err
      // Over the budget after all: keep the newer half of this session once.
      const keep = Math.max(1, Math.floor(s.turns.length / 2))
      s.dropped += s.turns.length - keep
      s.turns = s.turns.slice(-keep)
      await $.store.set(`s:${sid}`, s)
    }
  })
}

// A turn's end, with or without usage: drop its running step either way.
async function endTurn($: EngineInterface, turnId: string, agentId: string | undefined, u?: TurnUsage) {
  const sid = await $.session.id().catch(() => '')
  try {
    if (u) {
      await recordTurn($, turnId, agentId, u)
      lastError.delete(sid)
    }
  } catch (err) {
    lastError.set(sid, err instanceof Error ? err.message : String(err))
  } finally {
    steps.delete(`${sid}|${loop(agentId)}|${turnId}`)
  }
}

function tok(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

function clock(t: number) {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`

function row(cells: (string | number)[], widths: number[]) {
  return cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i] ?? 0) : String(c).padStart(widths[i] ?? 0))).join('  ')
}

// This session's turns: totals by kind and by agent, main-thread turns over the
// per-request target, cache rebuilds, then the most recent turns.
async function report($: EngineInterface, recent = 10) {
  const id = await $.session.id()
  const s = await loadSession($, id)
  const turns = s.turns
  if (turns.length === 0) {
    return `cost-log: no turns recorded yet in session ${id.slice(0, 8)}.` + (lastError.has(id) ? `\n⚠ The last turn was not recorded: ${lastError.get(id)}` : '')
  }

  const name = (a?: string) => (a === undefined ? 'main' : `${a.slice(0, 8)} ${s.agents[a] ?? 'subagent'}`)
  const lines: string[] = []
  const main = turns.filter(t => t.a === undefined)
  lines.push(
    `cost-log · session ${id.slice(0, 8)} · ${turns.length} turns (${main.length} main, ${turns.length - main.length} subagent)` +
      ` · ${clock(turns[0]!.t)}–${clock(turns[turns.length - 1]!.t)}` +
      (s.dropped ? ` · ${s.dropped} oldest turns dropped` : ''),
  )
  if (lastError.has(id)) lines.push(`⚠ The last turn was not recorded: ${lastError.get(id)}`)
  lines.push(
    'Cost-equivalent in base-input tokens: input 1x, cache read 0.1x, cache write 2x main (1h) / 1.25x subagent (5m), output 5x.',
    '',
  )

  const W1 = [34, 6, 5, 8, 8, 8, 8, 9, 6, 8]
  lines.push(row(['By agent', 'turns', 'reqs', 'input', 'read', 'write', 'output', 'cost-eq', 'share', 'per-req'], W1))
  const groups = new Map<string, Turn[]>()
  for (const t of turns) groups.set(loop(t.a), [...(groups.get(loop(t.a)) ?? []), t])
  const sum = (ts: Turn[], f: (t: Turn) => number) => ts.reduce((acc, t) => acc + f(t), 0)
  const total = sum(turns, t => cost(t, t.a))
  const sorted = [...groups.values()].sort((x, y) => sum(y, t => cost(t, t.a)) - sum(x, t => cost(t, t.a)))
  for (const ts of [...sorted, turns]) {
    const all = ts === turns
    const c = sum(ts, t => cost(t, t.a))
    const seen = ts.filter(t => !t.p)
    const reqs = sum(ts, t => t.n) // a floor where turns were partial
    const seenReqs = sum(seen, t => t.n)
    lines.push(
      row(
        [
          all ? 'all' : name(ts[0]!.a).slice(0, 34),
          ts.length,
          reqs,
          tok(sum(ts, t => t.in)),
          tok(sum(ts, t => t.rd)),
          tok(sum(ts, t => t.wr)),
          tok(sum(ts, t => t.out)),
          tok(c),
          `${Math.round((100 * c) / (total || 1))}%`,
          seen.length ? tok(sum(seen, t => cost(t, t.a)) / seenReqs) : '–',
        ],
        W1,
      ),
    )
  }

  const heavy = main.filter(t => !t.p && cost(t, t.a) / t.n > TARGET)
  const partial = main.filter(t => t.p).length
  lines.push(
    '',
    `Main-thread turns over ${tok(TARGET)} per request: ${heavy.length} of ${main.length - partial}` +
      (partial ? ` (${partial} more not judged: their requests were not all seen)` : ''),
  )
  for (const t of heavy.slice(-15)) {
    const reread = (t.rd * W.read) / t.n
    lines.push(
      `  ${clock(t.t)}  context ${tok(t.ctx)}  ${t.n} reqs  ${tok(cost(t, t.a) / t.n)}/req (re-read ${tok(reread)}/req)  peak ${tok(t.peak)}`,
    )
  }
  if (heavy.length > 15) lines.push(`  … ${heavy.length - 15} earlier`)

  const rebuilds = turns.filter(t => t.rb)
  lines.push('', `Cache rebuilds (large write after a gap past the TTL): ${rebuilds.length}`)
  for (const t of rebuilds.slice(-15)) {
    const rb = t.rb!
    lines.push(
      `  ${clock(t.t)}  ${name(t.a)}  gap ${minutes(rb.gap)}, wrote ${tok(rb.wr)} (cost-eq ${tok(rb.wr * writeWeight(t.a))})`,
    )
  }

  const W2 = [7, 30, 8, 5, 8, 8, 8, 9]
  lines.push('', row([`Last ${Math.min(recent, turns.length)}`, 'agent', 'context', 'reqs', 'read', 'write', 'output', 'cost-eq'], W2))
  for (const t of turns.slice(-recent)) {
    lines.push(
      row(
        [clock(t.t), name(t.a).slice(0, 30), tok(t.ctx), t.n, tok(t.rd), tok(t.wr), tok(t.out), tok(cost(t, t.a))],
        W2,
      ) + (t.rb ? '  rebuild' : ''),
    )
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'cost_log',
      description:
        "This session's per-turn token usage, recorded locally: tokens by kind, a cost-equivalent " +
        '(cache read 0.1x, write 2x main / 1.25x subagent, output 5x), totals by agent, main-thread turns ' +
        'over 25k per request, and cache rebuilds. Free: no model call. Use it to see where tokens go.',
      inputSchema: {
        type: 'object',
        properties: {
          turns: { type: 'number', description: 'How many recent turns to list (default 10).' },
        },
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'cost-log',
      description: "This session's per-turn token cost: /cost-log [recent turns to list]",
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const start = await $.clock.now()
    const done = yield* next(e)
    await noteStep($, e.turnId, e.index, e.agentId, start, done.usage).catch(() => undefined)
    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await endTurn($, e.turnId, e.agentId, e.usage ?? done.usage)
    return done
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { turns?: unknown }
    const n = typeof input.turns === 'number' && input.turns > 0 ? Math.floor(input.turns) : 10
    return { result: await report($, n) }
  })

  on('command.run', { command: 'cost-log' }, async ($, e) => {
    const n = Number.parseInt(e.args.trim(), 10)
    return { text: await report($, Number.isFinite(n) && n > 0 ? n : 10) }
  })
}
