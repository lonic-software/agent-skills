'use strict';
// Private, live, one-use capability. No serialization/import, refund or retry.
function createContinuation(attempt) {
  let spent = false;
  return Object.freeze({
    async consume() {
      if (spent) throw Error('MANAGED_CONTINUATION_SPENT'); // TOKEN_REUSE_GUARD
      spent = true; // Before the first await, admission, meter or spawn.
      return attempt();
    },
    spent: () => spent
  });
}
module.exports = {createContinuation};
