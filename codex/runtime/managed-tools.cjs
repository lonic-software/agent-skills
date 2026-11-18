'use strict';
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = () => {
  throw Error('MANAGED_HANDOFF_INVALID');
};
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const line = (v) => typeof v === 'string' && v.length <= 2048;
const lines = (v) => Array.isArray(v) && v.length <= 50 && v.every(line);
function workContext(v) {
  if (
    !exact(v, [
      'summary',
      'completedChecks',
      'openFindings',
      'nextActions',
      'sourceState',
    ]) ||
    !line(v.summary) ||
    !lines(v.completedChecks) ||
    !lines(v.openFindings) ||
    !lines(v.nextActions) ||
    !Array.isArray(v.sourceState) ||
    v.sourceState.length > 100 ||
    !v.sourceState.every(
      (r) => exact(r, ['path', 'state']) && line(r.path) && line(r.state),
    )
  )
    fail();
  if (Buffer.byteLength(JSON.stringify(v)) > 32768) fail();
  return clone(v);
}
function createManagedTools({
  grant,
  admission,
  readUsage,
  isLive,
  stop,
  tokens = () => null,
}) {
  let accepted = null,
    reserved = false;
  const check = () => {
    if (!isLive() || admission.status().stopped)
      throw Error('MANAGED_GENERATION_RETIRED');
  };
  async function context() {
    check();
    if (accepted) throw Error('MANAGED_HANDOFF_FINAL');
    const result = await admission.refreshUsage(readUsage);
    check();
    if (!result.allowed) throw Error('MANAGED_USAGE_REFUSED');
    const b = admission.runBudget.snapshot();
    // Explicit outward allowlist; neither raw responses nor account digests.
    return {
      allowed: true,
      usage: {
        usedPercent: b.lastPercent,
        threshold: b.threshold,
        remainingPercent: Math.max(0, b.threshold - b.lastPercent),
        resetsAt: b.resetsAt,
      },
      tokens: clone(tokens()),
    };
  }
  async function handoff(args) {
    check();
    if (reserved || accepted) {
      stop('MANAGED_DUPLICATE_HANDOFF');
      fail();
    }
    reserved = true;
    try {
      if (
        !exact(args, ['status', 'reason', 'itemId', 'context']) ||
        !['continue', 'done', 'stop'].includes(args.status) ||
        !line(args.reason) ||
        !args.reason.trim() ||
        args.itemId !== grant.task.itemId
      )
        fail();
      const captured = workContext(args.context),
        status = args.status,
        reason = args.reason;
      await context();
      check();
      accepted = {
        schema: 2,
        status,
        reason,
        itemId: grant.task.itemId,
        context: captured,
      };
      return {
        saved: true,
        status,
        instruction:
          'End this turn now. Only the host may decide continuation.',
      };
    } catch {
      stop('MANAGED_HANDOFF_INVALID');
      throw Error('MANAGED_HANDOFF_INVALID');
    }
  }
  return Object.freeze({
    async request(name, args = {}) {
      check();
      if (accepted || reserved) {
        stop('MANAGED_HANDOFF_FINAL');
        throw Error('MANAGED_HANDOFF_FINAL');
      }
      if (name === 'lonic_context') {
        if (!exact(args, [])) throw Error('MANAGED_CONTEXT_INVALID');
        return context();
      }
      if (name === 'lonic_cost_log') {
        if (!exact(args, [])) throw Error('MANAGED_CONTEXT_INVALID');
        return { tokens: clone(tokens()) };
      }
      if (name === 'lonic_handoff') return handoff(args);
      throw Error('MANAGED_TOOL_UNKNOWN');
    },
    accepted() {
      return accepted ? clone(accepted) : null;
    },
  });
}
const text = { type: 'string', maxLength: 2048 },
  array = { type: 'array', maxItems: 50, items: text };
const contextSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'completedChecks',
    'openFindings',
    'nextActions',
    'sourceState',
  ],
  properties: {
    summary: text,
    completedChecks: array,
    openFindings: array,
    nextActions: array,
    sourceState: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'state'],
        properties: { path: text, state: text },
      },
    },
  },
};
const catalog = [
  {
    name: 'lonic_context',
    description: 'Read fresh host-controlled usage. No disk authority.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'lonic_cost_log',
    description: 'Read only measured token counts; missing is unknown.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'lonic_handoff',
    description:
      'Submit bounded work context as the last tool call, then end this turn. Never submit permissions or a resume prompt.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason', 'itemId', 'context'],
      properties: {
        status: { type: 'string', enum: ['continue', 'done', 'stop'] },
        reason: text,
        itemId: text,
        context: contextSchema,
      },
    },
  },
];
module.exports = { createManagedTools, workContext, catalog };
