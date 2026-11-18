'use strict';
const catalog = require('./managed-config-keys.json');
const known = new Set(catalog.config),
  features = new Set(catalog.features);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function verifiedConfigNames(response) {
  if (!record(response?.config) || !Array.isArray(response.layers))
    return false;
  return [response.config, ...response.layers.map((l) => l?.config)].every(
    (c) =>
      record(c) &&
      Object.keys(c).every((k) => known.has(k)) &&
      (c.features == null ||
        (record(c.features) &&
          Object.keys(c.features).every((k) => features.has(k)))),
  );
}
module.exports = { verifiedConfigNames };
