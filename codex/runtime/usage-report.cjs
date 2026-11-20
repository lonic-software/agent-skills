'use strict';
const fs = require('node:fs');
const fields = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
];
function counts(value) {
  if (!value) return null;
  const out = {};
  for (const key of fields) {
    const n = value[key] ?? (key === 'cacheWriteInputTokens' ? 0 : NaN);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    out[key] = n;
  }
  if (
    out.cachedInputTokens + out.cacheWriteInputTokens > out.inputTokens ||
    out.reasoningOutputTokens > out.outputTokens
  )
    return null;
  return out;
}
function validatePrices(p) {
  if (p === undefined) return;
  for (const key of [
    'inputPerMillion',
    'cachedInputPerMillion',
    'cacheWritePerMillion',
    'outputPerMillion',
  ])
    if (!Number.isFinite(p?.[key]) || p[key] < 0)
      throw Error('Prices need nonnegative explicit rates per million tokens');
  if (
    typeof p.model !== 'string' ||
    !p.model ||
    typeof p.source !== 'string' ||
    !p.source ||
    typeof p.asOf !== 'string' ||
    !Number.isFinite(Date.parse(p.asOf))
  )
    throw Error('Prices need a model, source and asOf date');
}
function equivalent(c, p) {
  if (!p || !c) return null;
  return (
    ((c.inputTokens - c.cachedInputTokens - c.cacheWriteInputTokens) *
      p.inputPerMillion +
      c.cachedInputTokens * p.cachedInputPerMillion +
      c.cacheWriteInputTokens * p.cacheWritePerMillion +
      c.outputTokens * p.outputPerMillion) /
    1e6
  );
}
function summarize(
  events,
  { model, prices, nextPhaseTokens, mainThreadId } = {},
) {
  validatePrices(prices);
  if (prices && prices.model !== model)
    throw Error('Price model differs from the configured model');
  const threads = new Map(),
    turns = new Map();
  let invalidEvents = 0;
  for (const e of events) {
    if (e.method !== 'thread/tokenUsage/updated') continue;
    const p = e.params,
      c = counts(p?.tokenUsage?.total),
      last = counts(p?.tokenUsage?.last);
    if (
      !c ||
      !last ||
      typeof p.threadId !== 'string' ||
      typeof p.turnId !== 'string'
    ) {
      invalidEvents++;
      continue;
    }
    const previous = threads.get(p.threadId);
    if (previous && fields.some((k) => c[k] < previous.total[k])) {
      invalidEvents++;
      continue;
    }
    const delta = Object.fromEntries(
      fields.map((k) => [k, c[k] - (previous?.total[k] || 0)]),
    );
    const key = p.threadId + '\0' + p.turnId,
      turn = turns.get(key) || {
        threadId: p.threadId,
        turnId: p.turnId,
        tokens: Object.fromEntries(fields.map((k) => [k, 0])),
        updates: 0,
      };
    if (!previous || fields.some((k) => delta[k] !== 0)) {
      for (const k of fields) turn.tokens[k] += delta[k];
      turn.updates++;
      turns.set(key, turn);
    }
    threads.set(p.threadId, {
      threadId: p.threadId,
      total: c,
      last,
      modelContextWindow: p.tokenUsage.modelContextWindow ?? null,
      turnId: p.turnId,
    });
  }
  const main = threads.get(mainThreadId),
    context = main
      ? {
          lastRequestTokens: main.last.inputTokens + main.last.outputTokens,
          modelContextWindow: main.modelContextWindow,
          basis:
            'Last reported request input plus output; not a live context inventory or auto-compaction threshold',
        }
      : null;
  let breakEven = null;
  if (nextPhaseTokens !== undefined) {
    if (!Number.isSafeInteger(nextPhaseTokens) || nextPhaseTokens < 0)
      throw Error('nextPhaseTokens must be a nonnegative integer');
    if (context && prices && prices.cachedInputPerMillion > 0) {
      const saved = context.lastRequestTokens - nextPhaseTokens;
      breakEven = {
        estimatedFreshTokens: nextPhaseTokens,
        strictlyMoreThanTurns:
          saved > 0
            ? (nextPhaseTokens * prices.inputPerMillion) /
              (saved * prices.cachedInputPerMillion)
            : null,
        assumption:
          'Fresh input is uncached; retained input is cached; subsequent work and output equal. Estimate only, not a cache guarantee.',
      };
    }
  }
  const list = [...turns.values()].map((t) => ({
    ...t,
    apiPriceEquivalentUSD:
      t.threadId === mainThreadId ? equivalent(t.tokens, prices) : null,
  }));
  return {
    schema: 1,
    model,
    context,
    breakEven,
    prices: prices || null,
    invalidEvents,
    coverage:
      'Only threads/events delivered to this controller. Missing child events are not zero usage. Child costs remain unknown without an effective model.',
    subscriptionCharge: null,
    threads: [...threads.values()],
    turns: list,
    heavyTurns: [...list]
      .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
      .slice(0, 10),
    cacheWriteObservations: list
      .filter((t) => t.tokens.cacheWriteInputTokens > 0)
      .map((t) => ({
        threadId: t.threadId,
        turnId: t.turnId,
        tokens: t.tokens.cacheWriteInputTokens,
      })),
    note: 'API price equivalents are estimates, not subscription charges. Cache-write observations do not prove cache expiry or rebuild cause.',
  };
}
function readEvents(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
module.exports = { summarize, counts, equivalent, validatePrices, readEvents };
if (require.main === module) {
  try {
    const [file, model, mainThreadId, pricesFile] = process.argv.slice(2);
    if (!file)
      throw Error(
        'Usage: node usage-report.cjs EVENTS_JSONL MODEL MAIN_THREAD_ID [PRICES_JSON]',
      );
    console.log(
      JSON.stringify(
        summarize(readEvents(file), {
          model,
          mainThreadId,
          prices: pricesFile
            ? JSON.parse(fs.readFileSync(pricesFile, 'utf8'))
            : undefined,
        }),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
