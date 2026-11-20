'use strict';
const readline = require('node:readline/promises');
const { enrollAccount } = require('./managed-admission.cjs');
function terminalEnrollment(input = process.stdin, output = process.stderr) {
  if (input.isTTY !== true || output.isTTY !== true)
    throw Error('INTERACTIVE_TERMINAL_REQUIRED');
  return {
    inputTTY: true,
    outputTTY: true,
    display(text) {
      output.write(text + '\n');
    },
    async confirm(prompt) {
      const line = readline.createInterface({ input, output, terminal: true });
      try {
        return await line.question(prompt + ' ');
      } finally {
        line.close();
      }
    },
  };
}
async function enrollManagedAccount(host, terminal, { replace = false } = {}) {
  // Neither a hash argument nor noninteractive input can approve an account.
  if (terminal?.inputTTY !== true || terminal?.outputTTY !== true)
    throw Error('INTERACTIVE_TERMINAL_REQUIRED');
  let record;
  try {
    if (
      replace &&
      (await terminal.confirm(
        'Replace the existing approved account? Type REENROLL to continue:',
      )) !== 'REENROLL'
    )
      throw Error();
    await host.beginEnrollment({ replace });
    await enrollAccount({
      terminal,
      readSample: () => host.readEnrollmentSample(),
      save: (value) => {
        record = value;
      },
    });
    if (!(await host.finishEnrollment(record)).allowed) throw Error(); // Readers settled; commit under the live gate.
    return { status: 'enrolled' };
  } catch (error) {
    if (require('./managed-inventory-rules.cjs').isRefusal(error)) throw error;
    if (error?.cleanRefusal === true && error.code === 'PROCESS_SPAWN_FAILED')
      throw Object.assign(Error('PROCESS_SPAWN_FAILED'), {
        code: 'PROCESS_SPAWN_FAILED',
        ruleId: 'SPAWN_NO_PROCESS',
        cleanRefusal: true,
        recoveryRequired: false,
      });
    throw Error('MANAGED_ENROLLMENT_FAILED');
  } finally {
    await host.dispose();
  }
}
module.exports = { terminalEnrollment, enrollManagedAccount };
