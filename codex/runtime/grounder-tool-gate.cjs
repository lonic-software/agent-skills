'use strict';
// Lab prototype: this gate restricts its own MCP path, not every Codex tool.
const ALLOWED = Object.freeze([
  'brief',
  'look',
  'run',
  'fact',
  'record',
  'query',
  'workspaces',
]);
function createGrounderGate(catalog, upstream, toolNames = ALLOWED) {
  if (
    !catalog ||
    !Array.isArray(catalog.tools) ||
    typeof upstream !== 'function'
  )
    throw new TypeError('Catalog and upstream callback required');
  if (
    !Array.isArray(toolNames) ||
    new Set(toolNames).size !== toolNames.length ||
    toolNames.some((n) => typeof n !== 'string')
  )
    throw new TypeError('Unique tool names required');
  const allowed = new Set(toolNames),
    selected = [];
  for (const name of toolNames) {
    const matches = catalog.tools.filter((tool) => tool.name === name);
    if (matches.length !== 1)
      throw new Error('Expected exactly one upstream tool: ' + name);
    selected.push(structuredClone(matches[0]));
  }
  function reject(message, code) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  return Object.freeze({
    async request(method, params = {}) {
      if (method === 'tools/list') return { tools: structuredClone(selected) };
      if (method !== 'tools/call')
        return reject('Grounder gate refuses method: ' + method, -32601);
      if (
        !params ||
        typeof params.name !== 'string' ||
        !allowed.has(params.name)
      )
        return reject(
          'Grounder gate refuses tool: ' + String(params?.name),
          -32602,
        );
      const args = params.arguments === undefined ? {} : params.arguments;
      if (args === null || Array.isArray(args) || typeof args !== 'object')
        return reject('Tool arguments must be an object', -32602);
      return upstream('tools/call', {
        name: params.name,
        arguments: structuredClone(args),
      });
    },
  });
}
module.exports = { ALLOWED, createGrounderGate };
