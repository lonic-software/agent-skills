#!/usr/bin/env bash
# tool-gate.sh — PreToolUse hook for tools other than Bash (matcher
# "mcp__.*tetel__render|Agent|AskUserQuestion"). gate.sh owns Bash; this owns the gates whose input is a
# tool call's arguments rather than a command line. Only where the powerup marker is set
# (powerup-mark, in this work tree's git dir); elsewhere it allows everything.
#
#   tetel render      the design's scope gate and size tripwires (design-doc, Slice size): the
#                     workspace must have a design-ledger open, every modification target must be in
#                     the scope recorded at open or widened by a recorded decision, no claim may be
#                     over ~8k characters, and the ratchet must not be blocking (loop-tetel).
#   Agent             spawning a design attacker or a grounder (either name, with or without a
#                     plugin prefix) asks the design-ledger ratchet of this tree's open design.
#   AskUserQuestion   while a run marker is set (powerup-auto, queue-run, queue-fleet,
#                     powerup-fleet): denied outside the run's availability windows (queue-run §1d),
#                     which come from the fleet's run.json or, for a solo run, `powerup-mark window`.
#
# It never denies on its own errors (a missing jq, tetel or ledger script, a ledger it cannot read):
# those are logged to ${GATE_LOG:-$HOME/.claude/hooks/gate.log} and the call is allowed. A window
# rule that cannot be read is not such an error: the question is denied, naming the rule.
# Bash 3.2 compatible. `--self-test` feeds it sample hook JSON.
set -u

LOG=${GATE_LOG:-$HOME/.claude/hooks/gate.log}
log() { { printf '%s tool-gate.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; } 2>/dev/null; }
oops() { log "$*"; exit 0; }
deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}' \
    || oops "jq failed writing a deny"
  exit 0
}

marker() { # cwd → the marker path when it exists
  local gd; gd=$(cd "$1" 2>/dev/null && git rev-parse --absolute-git-dir 2>/dev/null) || return 1
  [ -f "$gd/powerup-active" ] && printf '%s\n' "$gd/powerup-active"
}
skills_dir() { # marker → its skills dir, else the installed one
  local d; d=$(sed -n 's/^skills_dir=//p' "$1" | head -n 1)
  [ -d "$d" ] || d="$HOME/.claude/skills"
  printf '%s\n' "$d"
}

gate_render() { # cwd marker workspace
  local sd ledger memo out st
  sd=$(skills_dir "$2"); ledger="$sd/design-doc/design-ledger"
  [ -x "$ledger" ] || oops "no design-ledger at $ledger; render of $3 not gated"
  command -v "${TETEL_BIN:-tetel}" >/dev/null 2>&1 || oops "tetel not on PATH; render of $3 not gated"
  memo=$(cd "$1" && "${TETEL_BIN:-tetel}" render --workspace "$3" 2>/dev/null) || oops "tetel render --workspace $3 failed; not gated"
  out=$(cd "$1" && printf '%s\n' "$memo" | "$ledger" render-check --workspace "$3" 2>&1); st=$?
  case "$st" in
    0) exit 0 ;;
    1) deny "${out#design-ledger: }" ;;
    3) deny "render of workspace $3 is refused: no design ledger is open for it. Check the item's size first (design-doc, Slice size), then: $ledger open --item <id> --workspace $3 --dims \"<the contract's quantified variables>\" --scope \"<target:/cmd:/flag:/exit:/file: tokens>\"" ;;
    *) oops "design-ledger render-check exited $st for $3: $out" ;;
  esac
}

gate_agent() { # cwd marker subagent_type
  local step
  case "${3##*:}" in
    lonic-design-attacker) step=attack ;;
    lonic-grounder) step=ground ;;
    *) exit 0 ;;
  esac
  local sd ledger out st
  sd=$(skills_dir "$2"); ledger="$sd/design-doc/design-ledger"
  [ -x "$ledger" ] || oops "no design-ledger at $ledger; $3 not gated"
  out=$(cd "$1" && "$ledger" gate "$step" 2>&1); st=$?
  case "$st" in
    0) exit 0 ;;
    1) deny "spawning $3 is refused: ${out#design-ledger: }" ;;
    3) deny "spawning $3 is refused: no design ledger is open in this work tree. Open one at intake ($ledger open …), or point this tree at the item's ledger ($ledger point <item>)" ;;
    *) oops "design-ledger gate exited $st: $out" ;;
  esac
}

gate_ask() { # cwd marker
  grep -qxE 'powerup-auto|queue-run|queue-fleet|powerup-fleet' "$2" || exit 0
  # Setup (queue-run §1) asks freely: the windows gate only once the parameters are resolved, which
  # a fleet's run.json or the marker's resolved line records.
  local gcd; gcd=$(cd "$1" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  grep -qx 'params=resolved' "$2" || { [ -n "$gcd" ] && [ -f "$gcd/fleet/run.json" ]; } || exit 0
  local sd pm out st
  sd=$(skills_dir "$2"); pm="$sd/powerup/powerup-mark"
  [ -x "$pm" ] || oops "no powerup-mark at $pm; AskUserQuestion not window-gated"
  out=$(cd "$1" && "$pm" in-window 2>&1); st=$?
  case "$st" in
    0) exit 0 ;;
    1|3) deny "outside window: park per queue-run §1d. $out. If the user has told you when they are available, record it first (a fleet: fleet window set \"<rules>\"; a solo run: powerup-mark window \"<rule>\"), then ask. Otherwise bring the item to resumable state, mark its queue entry 'blocked on user — Q: <the question in full>', notify the user once, and take another item." ;;
    2) deny "AskUserQuestion is refused: $out. Fix the recorded window (a fleet: fleet window set \"<rules>\"; a solo run: powerup-mark window --clear, then powerup-mark window \"<rule>\"), or park per queue-run §1d." ;;
    *) oops "powerup-mark in-window exited $st: $out" ;;
  esac
}

main() {
  command -v jq >/dev/null 2>&1 || oops "jq missing; allowing"
  local input tool cwd m
  input=$(cat) || oops "no stdin"
  tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || oops "unparsable hook input"
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}
  m=$(marker "$cwd") || exit 0
  case "$tool" in
    mcp__*tetel__render)
      local ws; ws=$(printf '%s' "$input" | jq -r '.tool_input.workspace // empty')
      [ -n "$ws" ] || exit 0
      gate_render "$cwd" "$m" "$ws" ;;
    Agent|Task)
      local t; t=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty')
      gate_agent "$cwd" "$m" "$t" ;;
    AskUserQuestion) gate_ask "$cwd" "$m" ;;
  esac
  exit 0
}

self_test() {
  local self tmp fails=0 out
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/tool-gate-self.XXXXXX"); tmp=$(cd "$tmp" && pwd -P)
  local skills; skills="$(cd "$(dirname "$0")/../skills" && pwd)"
  export GATE_LOG="$tmp/gate.log"
  # a fake tetel that renders the memo in $tmp/memo.md
  mkdir -p "$tmp/bin"; printf '#!/bin/sh\ncat "%s/memo.md"\n' "$tmp" > "$tmp/bin/tetel"; chmod +x "$tmp/bin/tetel"
  export TETEL_BIN="$tmp/bin/tetel"
  memo() { printf '## Modification targets\n\n| target | censused by |\n|---|---|\n'; local t; for t in "$@"; do printf '| `%s` | F1 |\n' "$t"; done
           printf '\n## Evidence ledger\n\n| ID | Proposition | Status |\n|---|---|---|\n| C1 | short | open |\n\n## Facts\n'; }
  hook() { # tool json-input-fields → hook output
    printf '{"tool_name":"%s","cwd":"%s","tool_input":%s}' "$1" "$tmp/r" "$2" | bash "$self"
  }
  check() { # name want(deny|allow) text tool input
    local name=$1 want=$2 text=$3; out=$(hook "$4" "$5")
    if [ "$want" = allow ]; then
      [ -z "$out" ] && echo "ok   $name" || { echo "FAIL $name: $out"; fails=$((fails + 1)); }
    else
      printf '%s' "$out" | grep -q '"deny"' && printf '%s' "$out" | grep -q -- "$text" && echo "ok   $name" \
        || { echo "FAIL $name (wanted a deny with '$text'): $out"; fails=$((fails + 1)); }
    fi
  }
  ( cd "$tmp" && git init -q r && cd r && git commit -q --allow-empty -m base ) || return 1
  local DL="$skills/design-doc/design-ledger" PM="$skills/powerup/powerup-mark"
  memo heal_meta > "$tmp/memo.md"
  check "no marker: render is not gated"           allow "" mcp__tetel__render '{"workspace":"ws1"}'
  check "no marker: questions are not gated"       allow "" AskUserQuestion '{}'
  (cd "$tmp/r" && "$PM" set powerup >/dev/null)
  check "a render with no ledger is denied"        deny "no design ledger is open" mcp__tetel__render '{"workspace":"ws1"}'
  check "an attacker with no ledger is denied"     deny "no design ledger is open in this work tree" Agent '{"subagent_type":"lonic-design-attacker"}'
  check "other agents are not gated"               allow "" Agent '{"subagent_type":"lonic-advisor-medium"}'
  check "bare powerup: questions are not gated"    allow "" AskUserQuestion '{}'
  (cd "$tmp/r" && "$DL" open --item X-1 --workspace ws1 --dims "a,b" --scope "target:heal_meta cmd:heal" >/dev/null)
  check "a render in scope is allowed"             allow "" mcp__tetel__render '{"workspace":"ws1"}'
  check "a plugin-prefixed tetel render is gated too" allow "" mcp__plugin_tetel_tetel__render '{"workspace":"ws1"}'
  memo heal_meta write_head > "$tmp/memo.md"
  check "a target outside the scope is denied"     deny "outside the scope recorded at open: write_head" mcp__tetel__render '{"workspace":"ws1"}'
  check "the plugin-prefixed render is denied too" deny "write_head" mcp__plugin_tetel_tetel__render '{"workspace":"ws1"}'
  (cd "$tmp/r" && "$DL" decide --note "agent+advisor: in intent" --widen "target:write_head" >/dev/null)
  check "after a widening decision it is allowed"  allow "" mcp__tetel__render '{"workspace":"ws1"}'
  (cd "$tmp/r" && "$DL" close >/dev/null && for i in 1 2 3; do "$DL" pass attack --build yes >/dev/null; done)
  check "the ratchet denies an attacker"           deny "ratchet" Agent '{"subagent_type":"lonic-design-attacker"}'
  check "and a prefixed grounder"                  deny "ratchet" Agent '{"subagent_type":"powerup:lonic-grounder"}'
  check "and the render a resumed pass would read" deny "ratchet" mcp__tetel__render '{"workspace":"ws1"}'
  (cd "$tmp/r" && "$DL" decide --note "agent+advisor: cut" >/dev/null)
  check "a decision lets the attacker through"     allow "" Agent '{"subagent_type":"lonic-design-attacker"}'
  # windows, under a run marker
  (cd "$tmp/r" && "$PM" set queue-run >/dev/null)
  check "setup questions pass before resolved"     allow "" AskUserQuestion '{}'
  (cd "$tmp/r" && "$PM" resolved >/dev/null)
  check "a run with no window denies a question"   deny "outside window: park per queue-run §1d" AskUserQuestion '{}'
  (cd "$tmp/r" && "$PM" window "daily 00:00-24:00 Europe/Budapest" >/dev/null)
  check "inside a window a question is allowed"    allow "" AskUserQuestion '{}'
  (cd "$tmp/r" && "$PM" window --clear >/dev/null && "$PM" window "until 2000-01-01 00:00 Europe/Budapest" >/dev/null)
  check "after the window a question is denied"    deny "outside window" AskUserQuestion '{}'
  (cd "$tmp/r" && mkdir -p .git/fleet && printf '{"windows":"until 23:00 Budapest"}' > .git/fleet/run.json)
  check "a fleet window that cannot be read denies, naming it" deny "cannot be read" AskUserQuestion '{}'
  check "and names the fleet's remedy"             deny "fleet window set" AskUserQuestion '{}'
  (cd "$tmp/r" && "$PM" set queue-run >/dev/null && sed -i.bak '/^params=resolved$/d' "$("$PM" path)" && printf '{"windows":""}' > .git/fleet/run.json)
  check "a fleet's run.json counts as resolved"    deny "outside window" AskUserQuestion '{}'
  rm -rf "$tmp"
  [ "$fails" -eq 0 ] && { echo "self-test: all passed"; return 0; }
  echo "self-test: $fails failed"; return 1
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
main
