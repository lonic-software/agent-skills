'use strict';
// No implicit author deadline. A host must explicitly select the recommendation
// or another finite duration. Cleanup has its separate, short deadline.
const DEFAULT_AUTHOR_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_AUTHOR_TIMEOUT_MS = 24 * 60 * 60 * 1000;
function authorTimeout(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 10 ||
    value > MAX_AUTHOR_TIMEOUT_MS
  )
    throw Error('MANAGED_AUTHOR_TIMEOUT_REQUIRED');
  return value;
}
module.exports = {
  authorTimeout,
  DEFAULT_AUTHOR_TIMEOUT_MS,
  MAX_AUTHOR_TIMEOUT_MS,
};
