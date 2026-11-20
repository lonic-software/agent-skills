'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { readAccountUsage } = require('./account-usage.cjs');
const { checkBudget } = require('./queue-budget.cjs');
const { writeCheckpoint } = require('./queue-checkpoint.cjs');
function createQueueTools(descriptor, readUsage = readAccountUsage) {
  let handedOff = false;
  const readBudget = () =>
    JSON.parse(fs.readFileSync(descriptor.budgetFile, 'utf8'));
  function saveBudget(budget) {
    // Invalid-budget results have no replacement receipt. Keep the original for diagnosis.
    if (budget === undefined) return;
    const temp = descriptor.budgetFile + '.' + crypto.randomUUID() + '.tmp';
    let owned = false,
      error;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      owned = true;
      try {
        fs.writeFileSync(fd, JSON.stringify(budget) + '\n');
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, descriptor.budgetFile);
    } catch (e) {
      error = e;
      throw e;
    } finally {
      if (owned)
        try {
          fs.unlinkSync(temp);
        } catch (e) {
          if (!error && e.code !== 'ENOENT') throw e;
        }
    }
  }
  function cost_log() {
    return descriptor.usageFile && fs.existsSync(descriptor.usageFile)
      ? JSON.parse(fs.readFileSync(descriptor.usageFile, 'utf8'))
      : {
          context: null,
          turns: [],
          note: 'No measured token events yet; missing usage is not zero.',
        };
  }
  async function context(args = {}) {
    let state;
    try {
      const { response, observedAt } = await readUsage(
        descriptor.codex,
        descriptor.project,
      );
      state = checkBudget(readBudget(), response, { observedAt });
    } catch (e) {
      state = {
        allowed: false,
        reason: 'usage-read-failed',
        budget: { ...readBudget(), stopped: true },
      };
    }
    saveBudget(state.budget);
    const usage = cost_log();
    let breakEven = null;
    if (args.nextPhaseTokens !== undefined) {
      if (
        !Number.isSafeInteger(args.nextPhaseTokens) ||
        args.nextPhaseTokens < 0
      )
        throw Error('Invalid fresh-session estimate');
      const c = usage.context?.lastRequestTokens,
        p = usage.prices,
        r = args.nextPhaseTokens;
      if (c !== undefined && p && p.cachedInputPerMillion > 0)
        breakEven = {
          estimatedFreshTokens: r,
          strictlyMoreThanTurns:
            c > r
              ? (r * p.inputPerMillion) / ((c - r) * p.cachedInputPerMillion)
              : null,
          assumption:
            'Estimated uncached fresh input versus cached retained input; not a cache guarantee.',
        };
    }
    return { ...state, context: usage.context, cost: usage, breakEven };
  }
  async function handoff(args) {
    if (handedOff || fs.existsSync(descriptor.handoffFile))
      throw Error('A handoff already exists for this session');
    if (
      !['continue', 'stop', 'done'].includes(args.status) ||
      typeof args.reason !== 'string' ||
      !args.reason.trim()
    )
      throw Error('A valid status and reason are required');
    if (descriptor.itemId && args.itemId !== descriptor.itemId)
      throw Error('Bare powerup must keep its assigned item ID');
    const operatorDecisions = [
      ...(descriptor.priorOperatorDecisions || []),
      ...(descriptor.decisionsFile && fs.existsSync(descriptor.decisionsFile)
        ? JSON.parse(fs.readFileSync(descriptor.decisionsFile, 'utf8'))
        : []),
    ];
    const usage = await context();
    const data = {
      operatorDecisions,
      availability: descriptor.availability || null,
      runId: descriptor.runId,
      itemId: args.itemId,
      queue: descriptor.queue,
      entrySkill: descriptor.entrySkill,
      authority: descriptor.authority,
      exclusions: descriptor.exclusions,
      budget: usage.budget,
      resumePrompt: args.resumePrompt,
      sourceState: args.sourceState,
      completedChecks: args.completedChecks,
      openFindings: args.openFindings,
      blockedItems: args.blockedItems,
      nextActions: args.nextActions,
      status: usage.allowed ? args.status : 'stop',
      reason: usage.allowed ? args.reason : usage.reason,
    };
    const saved = writeCheckpoint(
      descriptor.checkpoints,
      'step-' + descriptor.step,
      data,
    );
    fs.writeFileSync(descriptor.handoffFile, JSON.stringify(saved) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    handedOff = true;
    return {
      saved: true,
      status: data.status,
      reason: data.reason,
      checkpoint: saved.file,
      sha256: saved.sha256,
      instruction:
        'This is the last tool call of this session. End the turn now. The controller decides whether another session may start.',
    };
  }
  return { context, cost_log, handoff };
}
const fields = {
  status: { type: 'string', enum: ['continue', 'stop', 'done'] },
  reason: { type: 'string' },
  itemId: { type: 'string' },
  resumePrompt: { type: 'string' },
  sourceState: { type: 'array', items: { type: 'object' } },
  completedChecks: { type: 'array', items: { type: 'string' } },
  openFindings: { type: 'array', items: { type: 'string' } },
  blockedItems: { type: 'array', items: { type: 'string' } },
  nextActions: { type: 'array', items: { type: 'string' } },
};
const catalog = [
  {
    name: 'context',
    description:
      'Read current Codex account usage, check this run budget, and persist the stop state. This is account usage, not context-window usage.',
    inputSchema: {
      type: 'object',
      properties: { nextPhaseTokens: { type: 'integer', minimum: 0 } },
      additionalProperties: false,
    },
  },
  {
    name: 'cost_log',
    description:
      'Read measured per-thread token usage, heavy turns and optional API-price equivalents. Missing child events or model prices remain unknown; not subscription charges.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'handoff',
    description:
      'Save the completed session checkpoint with immutable run authority and fresh measured budget. Call last, then end the turn. Use done when the queue is complete, stop when blocked, or continue for a safe next session.',
    inputSchema: {
      type: 'object',
      properties: fields,
      required: Object.keys(fields),
      additionalProperties: false,
    },
  },
];
module.exports = { createQueueTools, catalog };
if (require.main === module) {
  const descriptor = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
    tools = createQueueTools(descriptor);
  let buffer = '',
    pending = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    buffer += data;
    let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n);
      buffer = buffer.slice(n + 1);
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      if (request.id === undefined) continue;
      pending = pending.then(async () => {
        try {
          let result;
          if (request.method === 'initialize')
            result = {
              protocolVersion: request.params?.protocolVersion || '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'lonic-queue', version: '1' },
            };
          else if (request.method === 'tools/list') result = { tools: catalog };
          else if (request.method === 'ping') result = {};
          else if (request.method === 'resources/list')
            result = { resources: [] };
          else if (request.method === 'resources/templates/list')
            result = { resourceTemplates: [] };
          else if (
            request.method === 'tools/call' &&
            Object.hasOwn(tools, request.params?.name)
          ) {
            const value = await tools[request.params.name](
              request.params.arguments || {},
            );
            result = {
              content: [{ type: 'text', text: JSON.stringify(value) }],
              structuredContent: value,
              isError: false,
            };
          } else throw Error('Unsupported queue method');
          process.stdout.write(
            JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n',
          );
        } catch (e) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32000, message: e.message },
            }) + '\n',
          );
        }
      });
    }
  });
}
