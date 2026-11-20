'use strict';
const { BUILTIN_CONTEXT_KEYS } = require('./managed-instruction-config.cjs');
// Shared by every managed reader and author. Profile configuration is not edited.
function managedIsolationSettings() {
  return {
    ...Object.fromEntries(BUILTIN_CONTEXT_KEYS.map((key) => [key, false])),
    'mcp_servers.node_repl.enabled': false,
    'features.apps': false,
    'features.plugins': false,
    'features.hooks': false,
    'features.memories': false,
    'features.multi_agent': false,
    'agents.enabled': false,
    'skills.bundled.enabled': false,
    'skills.include_instructions': false,
    project_doc_max_bytes: 0,
    web_search: 'disabled',
  };
}
module.exports = { managedIsolationSettings };
