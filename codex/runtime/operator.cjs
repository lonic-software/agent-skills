'use strict';
const readline = require('node:readline');
function validateAvailability(value) {
  if (value === undefined) return;
  if (
    !value ||
    typeof value.timeZone !== 'string' ||
    !Array.isArray(value.windows) ||
    !value.windows.length
  )
    throw Error('Availability needs an IANA timeZone and windows');
  new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format();
  for (const w of value.windows)
    if (
      !Array.isArray(w.days) ||
      !w.days.length ||
      w.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.end) ||
      w.start === w.end
    )
      throw Error('Invalid availability window; days use Monday=1 to Sunday=7');
}
function availableUntil(availability, now = Date.now()) {
  if (!availability) return Infinity;
  const matches = (time) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: availability.timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(time)
        .map((p) => [p.type, p.value]),
    );
    const day =
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) +
        1,
      clock = p.hour + ':' + p.minute;
    return availability.windows.some((w) =>
      w.start < w.end
        ? w.days.includes(day) && clock >= w.start && clock < w.end
        : (w.days.includes(day) && clock >= w.start) ||
          (w.days.includes(day === 1 ? 7 : day - 1) && clock < w.end),
    );
  };
  if (!matches(now)) return now;
  // Minute boundaries in actual time also handle DST gaps and repeated hours.
  let end = Math.floor(now / 60000) * 60000 + 60000;
  for (let n = 0; n < 8 * 24 * 60; n++, end += 60000)
    if (!matches(end)) return end;
  return Infinity;
}
const commandMethods = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);
function kindOf(request) {
  if (commandMethods.has(request.method)) return 'approval';
  if (request.method === 'item/permissions/requestApproval')
    return 'permissions';
  if (request.method === 'mcpServer/elicitation/request') return 'elicitation';
  if (request.method === 'item/tool/requestUserInput') return 'questions';
  if (
    request.method === 'item/tool/call' &&
    request.params?.tool === 'lonic_ask'
  )
    return 'question';
  throw Error('Unsupported operator request: ' + request.method);
}
function denied(kind) {
  if (kind === 'approval') return { decision: 'decline' };
  if (kind === 'permissions') return { permissions: {}, scope: 'turn' };
  if (kind === 'elicitation') return { action: 'decline' };
  if (kind === 'questions') return { answers: {} };
  return {
    success: true,
    contentItems: [
      {
        type: 'inputText',
        text: JSON.stringify({
          available: false,
          answer: null,
          instruction:
            'Park this exact question. No decision or approval was supplied.',
        }),
      },
    ],
  };
}
function responseFor(kind, request, answer) {
  if (answer === null || answer === undefined) return denied(kind);
  if (kind === 'approval')
    return { decision: answer === 'approve' ? 'accept' : 'decline' };
  if (kind === 'permissions')
    return answer === 'approve'
      ? { permissions: request.params.permissions, scope: 'turn' }
      : denied(kind);
  if (kind === 'elicitation') {
    if (answer === 'approve') return { action: 'accept' };
    if (answer && answer.action === 'accept')
      return { action: 'accept', content: answer.content };
    return denied(kind);
  }
  if (kind === 'questions') {
    const keys = new Set((request.params.questions || []).map((q) => q.id));
    if (
      !answer ||
      typeof answer !== 'object' ||
      Array.isArray(answer) ||
      Object.keys(answer).some((k) => !keys.has(k)) ||
      Object.values(answer).some((v) => typeof v !== 'string')
    )
      throw Error('Answers must map the displayed question IDs to text');
    return {
      answers: Object.fromEntries(
        Object.entries(answer).map(([k, v]) => [k, { answers: [v] }]),
      ),
    };
  }
  if (typeof answer !== 'string') throw Error('Question answer must be text');
  return {
    success: true,
    contentItems: [
      { type: 'inputText', text: JSON.stringify({ available: true, answer }) },
    ],
  };
}
function createOperator({
  ask,
  availability,
  timeoutMs = 120000,
  signal,
  now = Date.now,
  onDecision = () => {},
} = {}) {
  validateAvailability(availability);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000)
    throw Error('Invalid operator timeout');
  let queue = Promise.resolve();
  async function handle(request) {
    const kind = kindOf(request),
      started = now(),
      deadline = Math.min(
        started + timeoutMs,
        availableUntil(availability, started),
      );
    let answer = null,
      reason = 'operator-unavailable';
    if (ask && !signal?.aborted && deadline > started) {
      const abort = new AbortController();
      let timer, listener;
      try {
        answer = await Promise.race([
          ask({ kind, request, deadline, signal: abort.signal }),
          new Promise((resolve) => {
            const end = () => resolve(null);
            timer = setTimeout(end, deadline - started);
            listener = end;
            signal?.addEventListener('abort', end, { once: true });
          }),
        ]);
        reason = answer === null ? 'unanswered' : 'answered';
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', listener);
        abort.abort();
      }
    }
    // An answer received after the window closed never grants permission.
    if (now() >= deadline || signal?.aborted) {
      answer = null;
      reason = 'expired-or-cancelled';
    }
    const response = responseFor(kind, request, answer);
    await onDecision({
      at: new Date(now()).toISOString(),
      kind,
      request,
      response,
      reason,
    });
    return response;
  }
  return (request) => {
    const next = queue.then(() => handle(request));
    queue = next.catch(() => {});
    return next;
  };
}
function terminalAsk({ input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || !output.isTTY)
    throw Error('Interactive mode requires an attached terminal');
  return async ({ kind, request, signal }) => {
    const rl = readline.createInterface({ input, output });
    output.write(
      '\nUSER DECISION (untrusted request text follows):\n' +
        JSON.stringify(request.params, null, 2) +
        '\n',
    );
    try {
      return await new Promise((resolve) => {
        let ended = false;
        const finish = (value) => {
          if (ended) return;
          ended = true;
          signal.removeEventListener('abort', cancel);
          resolve(value);
        };
        const cancel = () => finish(null);
        signal.addEventListener('abort', cancel, { once: true });
        rl.on('close', cancel);
        rl.question(
          kind === 'question'
            ? 'Answer (empty parks it): '
            : kind === 'questions'
              ? 'JSON object of question ID: answer (empty parks it): '
              : 'Type approve for this request only, or decline: ',
          (value) => {
            if (!value.trim()) return finish(null);
            if (kind === 'questions') {
              try {
                return finish(JSON.parse(value));
              } catch {
                return finish(null);
              }
            }
            finish(value.trim());
          },
        );
        if (signal.aborted) cancel();
      });
    } finally {
      rl.close();
    }
  };
}
module.exports = {
  validateAvailability,
  availableUntil,
  kindOf,
  responseFor,
  createOperator,
  terminalAsk,
};
