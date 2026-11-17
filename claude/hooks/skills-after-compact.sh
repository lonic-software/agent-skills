#!/usr/bin/env bash
# SessionStart hook (matcher "startup|compact") for the powerup skill family.
#
# Why: after a compaction Claude Code re-attaches only skills invoked through the Skill tool, and
# truncates those; the files a powerup-family skill read (delivery, design-doc, queue-run, ...) do
# not come back, so the rules silently lapse mid-run.
#
#   source "compact"  → if this work tree has a powerup-active marker (written by
#                       skills/powerup/powerup-mark on a skill's opening read), inject the gate card
#                       and an instruction to re-read the listed skill files, by absolute path.
#   source "startup"  → a fresh process: delete the marker, so a record left by a session that never
#                       reached its stop cannot leak into an unrelated one. /clear (a handoff) and
#                       resume keep it.
#   anything else     → no output.
#
# Input: the hook JSON on stdin (fields used: source, cwd). Output: hookSpecificOutput JSON with
# additionalContext. Never fails the session: any error exits 0 silently.
# Needs jq. Bash 3.2 compatible. `--self-test` runs it against temp git repos.
set -u

marker_for() { # cwd -> marker path (must match powerup-mark's marker_path)
  local dir=$1 gd key
  if gd=$(cd "$dir" 2>/dev/null && git rev-parse --absolute-git-dir 2>/dev/null); then
    printf '%s/powerup-active\n' "$gd"
  else
    key=$(printf '%s' "$dir" | tr -c 'A-Za-z0-9._-' '_')
    printf '%s/.claude/powerup-active/%s\n' "$HOME" "$key"
  fi
}

files_for() { # skills_dir skill -> the SKILL files that skill reads at its opening
  local d=$1
  case "$2" in
    powerup)       printf '%s\n' "$d/powerup/SKILL.md" "$d/consult/SKILL.md" "$d/design-doc/SKILL.md" "$d/delivery/SKILL.md" "$d/evolve/SKILL.md" ;;
    powerup-auto)  files_for "$d" powerup; printf '%s\n' "$d/queue-run/SKILL.md" "$d/powerup-auto/SKILL.md" ;;
    powerup-fleet) files_for "$d" powerup; printf '%s\n' "$d/queue-run/SKILL.md" "$d/queue-fleet/SKILL.md" "$d/powerup-fleet/SKILL.md" ;;
    queue-fleet)   printf '%s\n' "$d/queue-run/SKILL.md" "$d/queue-fleet/SKILL.md" ;;
    *)             printf '%s\n' "$d/$2/SKILL.md" ;;
  esac
}

build_context() { # marker -> context text
  local marker=$1 skills_dir="" skills="" line
  while IFS= read -r line; do
    case "$line" in
      skills_dir=*) skills_dir=${line#skills_dir=} ;;
      "") ;;
      *) skills="$skills $line" ;;
    esac
  done < "$marker"
  [ -n "$skills_dir" ] && [ -n "$skills" ] || return 1
  local files="" s f
  for s in $skills; do files="$files
$(files_for "$skills_dir" "$s")"; done
  files=$(printf '%s\n' "$files" | awk 'NF && !seen[$0]++')
  printf 'POWERUP RULES AFTER COMPACTION. Active in this tree:%s.\n' "$skills"
  printf 'The compaction dropped the skill files those commands read. Before your next action, re-read these in full with the Read tool:\n'
  for f in $files; do [ -f "$f" ] && printf -- '- %s\n' "$f"; done
  printf -- "- and, if a design is in progress, %s/design-doc/method.md (plus loop-tetel.md beside it on the tetel route)\n" "$skills_dir"
  printf 'Do not rely on the summary'"'"'s paraphrase of them. Until they are re-read, the gate card below holds.\n\n'
  [ -f "$skills_dir/powerup/gates.md" ] && cat "$skills_dir/powerup/gates.md"
  return 0
}

main() {
  command -v jq >/dev/null 2>&1 || exit 0
  local input source cwd marker ctx
  input=$(cat) || exit 0
  source=$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null) || exit 0
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || exit 0
  [ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}
  marker=$(marker_for "$cwd")
  case "$source" in
    startup) rm -f "$marker"; exit 0 ;;
    compact)
      [ -f "$marker" ] || exit 0
      ctx=$(build_context "$marker") || exit 0
      jq -n --arg c "$ctx" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
      exit 0 ;;
    *) exit 0 ;;
  esac
}

self_test() {
  local self fails=0 tmp out
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/sac-self.XXXXXX")
  mkdir -p "$tmp/skills/powerup" "$tmp/skills/consult" "$tmp/skills/design-doc" "$tmp/skills/delivery" \
           "$tmp/skills/evolve" "$tmp/skills/queue-run" "$tmp/skills/powerup-auto" "$tmp/repo" "$tmp/other"
  for d in powerup consult design-doc delivery evolve queue-run powerup-auto; do echo x > "$tmp/skills/$d/SKILL.md"; done
  printf '# Powerup gate card\nGATE-LINE\n' > "$tmp/skills/powerup/gates.md"
  (cd "$tmp/repo" && git init -q . ) && (cd "$tmp/other" && git init -q .)
  local m; m=$(marker_for "$tmp/repo")
  printf 'skills_dir=%s\npowerup-auto\n' "$tmp/skills" > "$m"
  ok() { echo "ok   $1"; }
  bad() { echo "FAIL $1"; printf '%s\n' "${2:-}" | sed 's/^/     /'; fails=$((fails + 1)); }

  out=$(printf '{"source":"compact","cwd":"%s"}' "$tmp/repo" | "$self")
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null 2>&1 \
     && printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext | grep -q "GATE-LINE" \
     && printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext | grep -q -- "- $tmp/skills/queue-run/SKILL.md" \
     && printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext | grep -q -- "- $tmp/skills/delivery/SKILL.md"; then
    ok "compact with a marker injects the gate card and absolute re-read paths"
  else bad "compact with a marker injects the gate card and absolute re-read paths" "$out"; fi

  out=$(printf '{"source":"compact","cwd":"%s"}' "$tmp/other" | "$self")
  [ -z "$out" ] && ok "compact without a marker injects nothing" || bad "compact without a marker injects nothing" "$out"

  out=$(printf '{"source":"clear","cwd":"%s"}' "$tmp/repo" | "$self")
  [ -z "$out" ] && [ -f "$m" ] && ok "clear (a handoff) keeps the marker, injects nothing" || bad "clear keeps the marker" "$out"

  out=$(printf '{"source":"startup","cwd":"%s"}' "$tmp/repo" | "$self")
  [ -z "$out" ] && [ ! -f "$m" ] && ok "startup (a fresh process) deletes the marker" || bad "startup deletes the marker" "$out"

  out=$(printf 'not json' | "$self"); local st=$?
  [ "$st" -eq 0 ] && [ -z "$out" ] && ok "garbage input exits 0 silently" || bad "garbage input exits 0 silently" "$out"

  # The marker the skills write is the one this hook reads.
  local mark; mark="$(dirname "$self")/../skills/powerup/powerup-mark"
  if [ -x "$mark" ]; then
    (cd "$tmp/repo" && "$mark" set powerup >/dev/null)
    out=$(printf '{"source":"compact","cwd":"%s"}' "$tmp/repo" | "$self")
    printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext 2>/dev/null | grep -q "powerup/SKILL.md" \
      && ok "a marker written by powerup-mark is read by the hook" || bad "powerup-mark round trip" "$out"
    (cd "$tmp/repo" && "$mark" clear >/dev/null)
    [ ! -f "$m" ] && ok "powerup-mark clear removes it" || bad "powerup-mark clear removes it"
  else
    echo "skip powerup-mark round trip ($mark not installed)"
  fi

  rm -rf "$tmp"
  [ "$fails" -eq 0 ] && { echo "self-test: all passed"; return 0; }
  echo "self-test: $fails failed"; return 1
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
main
