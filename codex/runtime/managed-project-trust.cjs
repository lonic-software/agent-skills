'use strict';
const path = require('node:path');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Exact Windows project path, compared case-insensitively. N0d observed the
// lowercase spelling; S33's operator report also observed original casing.
// Case-only duplicates must all be explicitly trusted. No ancestor, prefix,
// normalization alias, device-path or operator-file inference is authority.
function projectTrusted(projects, cwd) {
  if (!record(projects) || typeof cwd !== 'string' || !/^[a-z]:\\/i.test(cwd) || path.win32.normalize(cwd) !== cwd) return false;
  const key = cwd.toLowerCase();
  const aliases = Object.keys(projects).filter(name => path.win32.isAbsolute(name) && path.win32.normalize(name).toLowerCase() === key);
  return aliases.length > 0 && aliases.every(name => {
    if (name.toLowerCase() !== key) return false; // Only case folding is admitted.
    const entry = projects[name];
    return record(entry) && Object.keys(entry).length === 1 && Object.hasOwn(entry, 'trust_level') && entry.trust_level === 'trusted';
  });
}
const TRUST_DIAGNOSTIC = 'Managed mode requires an explicit trusted entry for this exact project in config/read. Missing, untrusted or ambiguous project trust is refused before any thread. Establish project trust separately in your own Codex session; this command does not change the profile.';
module.exports = {projectTrusted, TRUST_DIAGNOSTIC};
