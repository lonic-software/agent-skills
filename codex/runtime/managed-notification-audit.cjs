'use strict';
// Never pass params, account values, thread IDs or other payloads to the sink.
// Audit failure must not turn a progress notification into a stop condition.
function auditNotification(audit, message) {
  if (typeof message?.method !== 'string') return;
  try {
    audit?.({ event: 'native-notification', method: message.method });
  } catch {}
}
module.exports = { auditNotification };
