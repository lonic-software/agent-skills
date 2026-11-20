'use strict';
// Reject namespace/configuration redirection, not editor authentication hints.
// Every inherited GIT_* value is removed from our own noninteractive Git calls.
const redirects =
  /^(GIT_(DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|REPLACE_REF_BASE|SHALLOW_FILE|GRAFT_FILE|ATTR_SOURCE|CONFIG.*))$/i;
function cleanGitEnvironment(env) {
  if (Object.keys(env).some((key) => redirects.test(key)))
    throw Error('MANAGED_GIT_REDIRECTION_REFUSED');
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)),
    ),
    GIT_TERMINAL_PROMPT: '0',
  };
}
module.exports = { cleanGitEnvironment };
