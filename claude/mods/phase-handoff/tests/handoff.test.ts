import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__phase-handoff__handoff' as const
const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }

function record(on: Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[1], surfaced = true) {
  const commands: string[] = []
  const prompts: string[] = []
  on('command.run', ($, e) => {
    commands.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('turn.complete', () => ({ text: '' }))
  if (surfaced) on('session.surfaces', (() => ({ value: ['terminal'] })) as never)
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return { commands, prompts }
}

test('handoff clears then submits the prompt after the countdown', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never)
  await $.tool.call({ tool: TOOL, prompt: 'Implement slice 2 from docs/plan.md', reason: 'design done' } as never)
  await $.turn.complete(done)
  await clock.advance(19_000)
  expect(seen.commands).toEqual([])
  await clock.advance(1_000)
  expect(seen.commands).toEqual(['/clear'])
  expect(seen.prompts).toEqual(['Implement slice 2 from docs/plan.md'])
})

test('a slash-command prompt runs as that command', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never)
  await $.tool.call({ tool: TOOL, prompt: '/powerup implement slice 2' } as never)
  await $.turn.complete(done)
  await clock.advance(20_000)
  expect(seen.commands).toEqual(['/clear', '/powerup implement slice 2'])
  expect(seen.prompts).toEqual([])
})

test('an interrupted turn cancels the handoff', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete({ ...done, reason: 'aborted', isAborted: true })
  await clock.advance(60_000)
  expect(seen.commands).toEqual([])
})

test('a subagent finishing does not start the countdown', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete({ ...done, agentId: 'a1' })
  await clock.advance(60_000)
  expect(seen.commands).toEqual([])
})

test('/handoff cancel stops a running countdown', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete(done)
  await clock.advance(5_000)
  await $.command.run({ command: 'handoff', args: 'cancel' })
  await clock.advance(60_000)
  expect(seen.commands.filter(c => c !== '/handoff cancel')).toEqual([])
})

test('an empty prompt is refused', async $ => {
  const ran = await $.tool.call({ tool: TOOL, prompt: '  ' } as never)
  expect(ran.deny).toContain('non-empty')
})

test('context reports C and the handoff break-even', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: {
      tokens: 300_000,
      window: 1_000_000,
      breakdown: { categories: [], isAutoCompactEnabled: true, autoCompactThreshold: 250_000 },
    },
    rateLimits: [{ kind: 'five_hour', percentUsed: 31 }],
    cost: { usd: 12.5 },
  } }) as never)
  const ran = await $.tool.call({ tool: 'mcp__phase-handoff__context', next_phase_tokens: 60_000 } as never)
  const text = JSON.stringify(ran.result)
  expect(text).toContain('Context (C): 300k')
  expect(text).toContain('auto-compact at 250k')
  expect(text).toContain('break-even with R = 60k: 5 turns')
  expect(text).toContain('five_hour 31%')
})

test('context reports each rate limit against the elapsed share of its window', async ($, on) => {
  const clock = mock.clock(on)
  const now = clock.now()
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 100_000, window: 1_000_000 },
    rateLimits: [
      // 1h of 5h left: 80% elapsed, 40% used.
      { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(now + 3600_000).toISOString() },
      // 6d of 7d left: 1/7 ≈ 14% elapsed, 30% used.
      { kind: 'seven_day', percentUsed: 30, resetsAt: new Date(now + 6 * 86400_000).toISOString() },
      { kind: 'spend_limit', percentUsed: 50 },
    ],
  } }) as never)
  const ran = await $.tool.call({ tool: 'mcp__phase-handoff__context' } as never)
  const text = JSON.stringify(ran.result)
  expect(text).toContain('Pace five_hour: 40% used vs 80% of the window elapsed (resets in 1h0m): under pace (0.50x); at this rate 50% by the reset.')
  expect(text).toContain('Pace seven_day: 30% used vs 14% of the window elapsed (resets in 6d0h): OVER pace (2.10x); at this rate 210% by the reset.')
  expect(text).not.toContain('Pace spend_limit')
})

type On = Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[1]

// A clock whose periods the test resolves one second at a time, and whose
// pending periods a dead process drops: the timer stops, the stored handoff stays.
function hostClock(on: On) {
  let waiting: Array<(r: unknown) => void> = []
  on('clock.every', (() => new Promise(r => waiting.push(r))) as never)
  const settle = () => new Promise(r => setTimeout(r, 0))
  return {
    async seconds(n: number) {
      for (let i = 0; i < n; i++) {
        const now = waiting; waiting = []
        now.forEach(r => r({ value: undefined }))
        await settle(); await settle()
      }
    },
    die() { waiting = [] },
  }
}

const surfaces = (on: On, list: string[]) => on('session.surfaces', (() => ({ value: list })) as never)
const host = (on: On) => {
  on('tool.register', (() => ({ value: undefined })) as never)
  on('command.register', (() => ({ value: undefined })) as never)
  on('session.start', (($: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  on('session.attach', (($: unknown, e: { clientId: string }) => ({ clientId: e.clientId })) as never)
}

test('a session restarted mid-countdown resumes it at start', async ($, on) => {
  const clock = hostClock(on)
  const seen = record(on as never, false)
  surfaces(on, ['terminal']); host(on)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete(done)
  await clock.seconds(5)
  clock.die()
  await clock.seconds(60)
  expect(seen.commands).toEqual([])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.seconds(14)
  expect(seen.commands).toEqual([])
  await clock.seconds(1)
  expect(seen.commands).toEqual(['/clear'])
  expect(seen.prompts).toEqual(['next'])
})

test('a client attaching to a stalled countdown resumes it', async ($, on) => {
  const clock = hostClock(on)
  const seen = record(on as never, false)
  surfaces(on, ['terminal']); host(on)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete(done)
  clock.die()
  await clock.seconds(60)
  expect(seen.commands).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await clock.seconds(20)
  expect(seen.commands).toEqual(['/clear'])
})

test('a restarted session nobody watches fires at once', async ($, on) => {
  const clock = hostClock(on)
  const seen = record(on as never, false)
  const list = ['terminal']
  surfaces(on, list); host(on)
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete(done)
  clock.die()
  list.length = 0
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  expect(seen.commands).toEqual(['/clear'])
})

test('with nothing drawing the session, the handoff fires at once', async ($, on) => {
  mock.clock(on)
  const seen = record(on as never, false)
  surfaces(on, [])
  await $.tool.call({ tool: TOOL, prompt: 'next' } as never)
  await $.turn.complete(done)
  expect(seen.commands).toEqual(['/clear'])
})

test('a start with no handoff pending does nothing', async ($, on) => {
  const clock = mock.clock(on)
  const seen = record(on as never, false)
  surfaces(on, []); host(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  await clock.advance(60_000)
  expect(seen.commands).toEqual([])
})
