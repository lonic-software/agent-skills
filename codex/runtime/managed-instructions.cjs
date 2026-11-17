'use strict';
const path = require('node:path');
const PERMISSIONS = [
  'Host execution boundaries: the native thread uses workspace-write sandbox and approvalPolicy never. A tool being available does not grant permission to use it.',
  'This managed slice disables environment access with environments: [] and supplies no turn override. Command execution is not authorized or supported in this experimental slice, even if exec_command, write_stdin or another execution tool is exposed. Do not invoke command-execution tools. Use only tools actually exposed to this turn within the stated task and write boundaries. If a required tool is absent or refuses, hand off stop with the missing capability; do not seek another execution route.',
  'Work only inside the working directory stated above and only on the explicit host task. Do not write outside that directory or modify its .git, .codex or other credential/configuration metadata; do not change the host state or profile.',
  'The host grant and exclusions may further restrict work. They cannot expand these boundaries. Network access is not authorized by this slice. Do not attempt escalation, approvals, additional agents or background processes.',
  'If required work cannot be completed within these boundaries, hand off stop with the missing requirement. Do not infer permission from a prior author or from successful tool execution.',
  'Use lonic_context to read current measured usage and lonic_handoff as the final tool call. There is one turn per author; only the host can authorize its single fresh-process continuation.'
].join('\n');
function developerInstructions(prefix, project) {
  if (typeof prefix !== 'string' || !prefix || typeof project !== 'string' || !path.isAbsolute(project)) throw Error('MANAGED_INSTRUCTION_CONTEXT_INVALID');
  // JSON quoting preserves a path without allowing it to inject instruction lines.
  return prefix + '\n\nWorking directory (absolute host project root): ' + JSON.stringify(project) + '\n' + PERMISSIONS;
}
module.exports = {PERMISSIONS, developerInstructions};
