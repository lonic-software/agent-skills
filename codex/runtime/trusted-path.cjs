'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A trusted installation root may not exist yet. Resolve its existing prefix,
// but do not treat a broken symlink as a directory that can be created.
function trustedRoot(value) {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (
      error.code !== 'ENOENT' ||
      absolute === path.dirname(absolute) ||
      fs.lstatSync(absolute, { throwIfNoEntry: false })
    )
      throw error;
    return path.join(
      trustedRoot(path.dirname(absolute)),
      path.basename(absolute),
    );
  }
}

function bindRoot(value) {
  const name = path.resolve(value);
  return { name, real: trustedRoot(name) };
}

const tempRoot = bindRoot(os.tmpdir());
function tempPath(value) {
  const absolute = path.resolve(value);
  const tail = path.relative(tempRoot.name, absolute);
  if (
    tail === '..' ||
    tail.startsWith('..' + path.sep) ||
    path.isAbsolute(tail)
  )
    return absolute;
  return path.join(tempRoot.real, tail);
}
function checkedPath(
  value,
  roots = [],
  message = 'Checkpoint paths must not traverse links',
) {
  const absolute = path.resolve(value);
  let base = path.parse(absolute).root;
  let relative = path.relative(base, absolute);
  for (const root of [...roots, tempRoot]) {
    for (const name of [root.name, root.real]) {
      const tail = path.relative(name, absolute);
      if (
        tail === '..' ||
        tail.startsWith('..' + path.sep) ||
        path.isAbsolute(tail)
      )
        continue;
      base = root.real;
      relative = tail;
      break;
    }
    if (base === root.real) break;
  }
  let cursor = base;
  for (const entry of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, entry);
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink())
      throw Error(message + ': ' + cursor);
  }
  return cursor;
}
module.exports = { trustedRoot, bindRoot, checkedPath, tempRoot, tempPath };
