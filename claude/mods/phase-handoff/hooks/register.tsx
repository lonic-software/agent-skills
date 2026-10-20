import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Handoff } from '../types'

const COUNTDOWN_SECONDS = 20
const TOOL = 'mcp__phase-handoff__handoff'
const CONTEXT_TOOL = 'mcp__phase-handoff__context'

const pending = atom({ plugin: 'phase-handoff', key: 'pending' } as const, null)

let tick: { cancel: () => void } | undefined

function stop() {
  tick?.cancel()
  tick = undefined
}

async function cancel($: EngineInterface, why: string) {
  stop()
  if ((await read($, pending)) === null) return false
  await update($, pending, () => null)
  $.ui.toast(`Handoff cancelled: ${why}`)
  return true
}

// Clear the conversation, then open the fresh one with the handed-off prompt.
// A prompt that starts with a slash command runs as one, so "/powerup …"
// re-enables the skill suite in the new session.
async function fire($: EngineInterface) {
  stop()
  const handoff = await read($, pending)
  if (handoff === null) return
  await update($, pending, () => null)

  await $.command.run({ command: 'clear' })
  const slash = /^\/([\w:.-]+)\s*([\s\S]*)$/.exec(handoff.prompt.trim())
  if (slash?.[1]) {
    await $.command.run({ command: slash[1], args: slash[2] ?? '' })
  } else {
    await $.prompt.submit({ text: handoff.prompt, asUser: true })
  }
}

async function countDown($: EngineInterface) {
  stop()
  await update($, pending, p => p && { ...p, secondsLeft: COUNTDOWN_SECONDS })
  tick = $.clock.every(1000, () => {
    void (async () => {
      const next = await update($, pending, p =>
        p && p.secondsLeft !== null ? { ...p, secondsLeft: p.secondsLeft - 1 } : p,
      )
      if (next === null) stop()
      else if ((next.secondsLeft ?? 1) <= 0) await fire($)
    })()
  })
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }

function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h${m % 60}m`
  return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
}

// Usage against time: how much of the window is used next to how much of it has
// elapsed. Used ahead of elapsed means spending faster than the window refills,
// and at that rate the limit is hit before the reset. Only for windows with a
// known length and a reset time; a spend limit has neither.
function paceLine(kind: string, used: number, resetsAt: string | undefined, now: number) {
  const length = WINDOW_MS[kind]
  const reset = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (length === undefined || Number.isNaN(reset)) return undefined
  const left = Math.min(length, Math.max(0, reset - now))
  const elapsed = (100 * (length - left)) / length
  const head = `Pace ${kind}: ${used}% used vs ${Math.round(elapsed)}% of the window elapsed (resets in ${span(left)})`
  if (elapsed < 1) return `${head}; too early in the window to judge.`
  const ratio = used / elapsed
  const projected = Math.round((used * 100) / elapsed)
  const verdict =
    ratio > 1.05 ? `OVER pace (${ratio.toFixed(2)}x)` : ratio < 0.95 ? `under pace (${ratio.toFixed(2)}x)` : 'on pace'
  return `${head}: ${verdict}; at this rate ${projected}% by the reset.`
}

// The live context and what it costs to carry, as the status line has it.
// With `nextPhaseTokens` (R, the agent's estimate of what a fresh session
// would need) it adds the handoff break-even from powerup's "weigh it" rule:
// a handoff pays after N > 20R / (C − R) further turns.
async function contextReport($: EngineInterface, nextPhaseTokens?: number, withBreakdown = false) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const c = usage.context.tokens
  const bd = usage.context.breakdown
  const lines: string[] = []

  if (c === undefined) {
    lines.push('Context: unknown until the first response of this session comes back.')
  } else {
    const compactAt = bd?.isAutoCompactEnabled ? bd.autoCompactThreshold : undefined
    lines.push(
      `Context (C): ${k(c)} tokens` +
        (compactAt ? `, auto-compact at ${k(compactAt)} (${Math.round((100 * c) / compactAt)}% of the way)` : '') +
        `; model window ${k(usage.context.window)}.`,
    )
    lines.push(`Each further turn re-reads it: ~${k(c * 0.1)} input-equivalent at cache-read price.`)
  }
  if (usage.cost) lines.push(`Session cost so far (API-priced): $${usage.cost.usd.toFixed(2)}.`)
  if (usage.rateLimits.length > 0) {
    lines.push(
      'Rate limits: ' + usage.rateLimits.map(r => `${r.kind} ${r.percentUsed}%`).join(', ') + '.',
    )
    const now = usage.rateLimits.some(r => r.resetsAt) ? await $.clock.now() : 0
    for (const r of usage.rateLimits) {
      const line = paceLine(r.kind, r.percentUsed, r.resetsAt, now)
      if (line) lines.push(line)
    }
  }

  if (nextPhaseTokens !== undefined && c !== undefined) {
    const r = nextPhaseTokens
    if (r >= c) {
      lines.push(`Handoff: R = ${k(r)} is not below C, so a fresh session never pays; continue.`)
    } else {
      const n = Math.ceil((20 * r) / (c - r))
      lines.push(
        `Handoff break-even with R = ${k(r)}: ${n} turns. Hand off if the next phase runs longer than that; continue if not.`,
      )
    }
  }

  if (withBreakdown && bd) {
    const top = [...bd.categories]
      .filter(cat => cat.tokens >= 500 && !cat.isDeferred && !/free space|buffer/i.test(cat.name))
      .sort((a, b) => b.tokens - a.tokens)
      .map(cat => `  ${cat.name}: ${k(cat.tokens)}`)
    lines.push('Breakdown (local estimate):', ...top)
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'handoff',
      description:
        'Start a fresh session for the next phase. Call it at a phase boundary (a design finished, a slice merged) ' +
        'once everything the next phase needs is on disk: memo, commits, notes, owed actions. ' +
        'After your turn ends the person gets a short countdown to cancel; then this conversation is cleared ' +
        'and `prompt` is submitted as the first message of the new session. Write `prompt` so it stands alone: ' +
        'it is all the new session will know. Start it with a slash command (e.g. "/powerup …") to run one first. ' +
        'Call it as your last action and end your turn right after. ' +
        'A handoff is not always cheaper: weigh it first with the `context` tool.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The first message of the fresh session.' },
          reason: { type: 'string', description: 'One line: which boundary this is.' },
        },
        required: ['prompt'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'context',
      description:
        "Read this session's live context size (C), how close it is to auto-compaction, what each turn costs to " +
        're-read, session cost and rate limits, each limit with its pace (usage against the share of its window ' +
        'already elapsed, and where that rate lands by the reset). Free to call: it reads what the status line already has. ' +
        'Pass `next_phase_tokens` (your estimate of R, what a fresh session would need: ~30k base plus the files ' +
        'it must read) to get the handoff break-even in turns. Use it before deciding to hand off, before loading ' +
        'something large, and when choosing between continuing and delegating.',
      inputSchema: {
        type: 'object',
        properties: {
          next_phase_tokens: { type: 'number', description: 'Estimated R in tokens, for the break-even.' },
          breakdown: { type: 'boolean', description: 'Also list what fills the context, by category.' },
        },
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'handoff',
      description: 'Handoff to a fresh session: /handoff now | cancel | <prompt>',
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { prompt?: unknown; reason?: unknown }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (e.agentId !== undefined) {
      return { deny: 'Only the main session can hand off.' }
    }
    if (prompt === '') {
      return { deny: '`prompt` must be a non-empty string.' }
    }
    const handoff: Handoff = {
      prompt,
      reason: typeof input.reason === 'string' ? input.reason : '',
      secondsLeft: null,
    }
    await update($, pending, () => handoff)
    const leaving = await $.session.usage().then(u => u.context.tokens, () => undefined)
    return {
      result:
        `Handoff scheduled${leaving === undefined ? '' : `, leaving a ${k(leaving)} context`}. When this turn ends the person has ${COUNTDOWN_SECONDS}s to cancel, ` +
        'then the session clears and the prompt starts the next one. End your turn now with a one-line summary; make no further tool calls.',
    }
  })

  on('tool.call', { tool: CONTEXT_TOOL }, async ($, e) => {
    const input = e as unknown as { next_phase_tokens?: unknown; breakdown?: unknown }
    const r = typeof input.next_phase_tokens === 'number' ? input.next_phase_tokens : undefined
    const text = await contextReport($, r, input.breakdown === true)
    return { result: text }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const handoff = await read($, pending)
    if (handoff !== null && handoff.secondsLeft === null) {
      if (e.reason === 'answer') await countDown($)
      else await cancel($, `turn ended (${e.reason})`)
    }
    return done
  })

  // Anything the person types while a handoff waits means they are still here.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') await cancel($, 'you sent a prompt')
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'cancel') {
      return { text: (await cancel($, 'by /handoff cancel')) ? 'Cancelled.' : 'No handoff pending.' }
    }
    if (args === 'now') {
      if ((await read($, pending)) === null) return { text: 'No handoff pending.' }
      void fire($)
      return { text: 'Starting the fresh session.' }
    }
    if (args === '') {
      const p = await read($, pending)
      return { text: p ? `Pending: ${p.prompt}` : 'No handoff pending. /handoff <prompt> schedules one.' }
    }
    await update($, pending, () => ({ prompt: args, reason: 'manual', secondsLeft: null }))
    await countDown($)
    return { text: `Fresh session in ${COUNTDOWN_SECONDS}s.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const handoff = await read($, pending)
    if (handoff === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const firstLine = handoff.prompt.split('\n')[0] ?? ''
    const preview = firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine
    const when =
      handoff.secondsLeft === null ? 'after this turn' : `in ${handoff.secondsLeft}s`

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="yellow">⏭ Fresh session {when}</Text>
          <Text dimColor>{handoff.reason ? ` · ${handoff.reason}` : ''} </Text>
          <Button key="now" label="Start now" hotkey="s" onPress={() => void fire($)} />
          <Text> </Text>
          <Button key="cancel" label="Cancel" hotkey="c" onPress={() => void cancel($, 'by you')} />
        </Box>
        <Text dimColor>  {preview}</Text>
      </Box>
    )
  })
}
