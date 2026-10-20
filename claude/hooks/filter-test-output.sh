#!/bin/bash
# PreToolUse hook (Bash): keeps test-runner output out of Claude's context.
#
# A test command with no pipe of its own is rewritten to capture its output to
# a temp file, print only failures and summary lines (everything, if short),
# and exit with the test runner's own status. Pattern from
# https://code.claude.com/docs/en/costs ("Offload processing to hooks").
#
# Deliberately does NOT set permissionDecision: the rewritten command still
# goes through the normal permission / auto-mode checks.
#
# Escape hatch: put FULL_TEST_OUTPUT=1 anywhere in the command to skip it.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

pass() { echo '{}'; exit 0; }

[[ -z "$cmd" ]] && pass
[[ "$cmd" == *"FULL_TEST_OUTPUT=1"* ]] && pass
[[ "$cmd" == *"|"* ]] && pass                     # caller already filters
[[ "$cmd" == *"<<"* ]] && pass                    # heredocs: leave alone
echo "$cmd" | grep -qE '(^|[;&[:space:]])((npx|pnpm|yarn|bunx)[[:space:]]+)?(vitest|jest)([[:space:];&]|$)|npm[[:space:]]+(run[[:space:]]+)?test|(^|[;&[:space:]])pytest([[:space:];&]|$)|go[[:space:]]+test' || pass

summary="$HOME/.claude/hooks/test-output-summary.sh"
wrapped="__t=\$(mktemp); { ${cmd}
} >\"\$__t\" 2>&1; __rc=\$?; bash \"$summary\" \"\$__t\"; rm -f \"\$__t\"; (exit \$__rc)"

printf '%s' "$input" | jq --arg c "$wrapped" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {command: $c})}}'
