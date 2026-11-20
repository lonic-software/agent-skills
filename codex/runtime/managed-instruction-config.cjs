'use strict';
// Codex 0.167.0 saved ConfigReadResponse schema explicitly declares the first
// three fields. The two file-loading fields are additionally denied by the
// managed contract. See managed-cli.md for evidence and the schema boundary.
const EMPTY_KEYS = Object.freeze([
  'instructions',
  'developer_instructions',
  'compact_prompt',
  'experimental_compact_prompt_file',
  'model_instructions_file',
  'experimental_realtime_ws_backend_prompt',
  'experimental_realtime_start_instructions',
]);
// Verified key identities and Boolean types, not proof of native semantics.
// The bounded managed source contract permits no unenumerated native context.
const BUILTIN_CONTEXT_KEYS = Object.freeze([
  'include_collaboration_mode_instructions',
  'include_environment_context',
  'include_permissions_instructions',
  'include_apps_instructions',
  'include_environment_context_time',
]);
const suspicious = /instructions|prompt|environment/i;
function emptyInstructionSources(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return false;
  return Object.keys(config).every((key) => {
    if (EMPTY_KEYS.includes(key))
      return config[key] == null || config[key] === '';
    if (BUILTIN_CONTEXT_KEYS.includes(key))
      return typeof config[key] === 'boolean';
    // These are explicit, reviewed exceptions, not pattern-based guesses.
    // Environments have their own CFG_ENVIRONMENTS rule. The entire effective
    // shell policy and layer contents remain part of configDigest / CONFIG_PIN.
    if (key === 'environments') return true;
    if (key === 'shell_environment_policy')
      return (
        config[key] == null ||
        (typeof config[key] === 'object' && !Array.isArray(config[key]))
      );
    // The generated schema permits additional properties; that does not make
    // an unknown instruction-like key safe, even with a currently empty value.
    return !suspicious.test(key);
  });
}
const builtinContextDisabled = (config) =>
  BUILTIN_CONTEXT_KEYS.every((key) => config?.[key] === false);
module.exports = {
  EMPTY_KEYS,
  BUILTIN_CONTEXT_KEYS,
  emptyInstructionSources,
  builtinContextDisabled,
};
