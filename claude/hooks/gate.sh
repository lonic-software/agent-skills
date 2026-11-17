#!/usr/bin/env bash
# gate.sh — PreToolUse hook (matcher "Bash"): the hard gates, as code, for every session in any repo.
#
# Always:
#   - The merge gate: the merged head is exactly the reviewed head, and every verification the
#     project has passed on that head. A forge merge (the config's merge_cmd; `gh pr merge` built in
#     when origin is on github.com) must pin the head (sha_flag, e.g. --match-head-commit <sha>),
#     that sha must be the change's head (head_cmd), and the evidence must pass at it: the CI checks
#     (checks_cmd; the config's required_checks, else every listed check pass or skipping) when the
#     project has CI, otherwise a verified stamp (delivery/verify-head). With no forge — no remote,
#     or forge "none" — a local `git merge` into the default branch needs a verified stamp for the
#     merged head. A forge the gate cannot recognise, unconfigured, is not gated at the forge; it is
#     logged instead (a remote-tracking sync merge is never gated).
#   - `git stash` is denied (except `list` and `show`): stash/pop on a clean tree pops an unrelated entry.
#   - `git push --force` / `-f` / `--force-with-lease` / a `+refspec`, and `git rebase`: ask the user first.
#   - `git commit` with no user.email at all (a scratch HOME, an unconfigured box): the commit would
#     carry an unlinked author.
# Only while $(git rev-parse --git-common-dir)/fleet/ exists (queue-fleet):
#   - `gh pr merge` also needs this slot to hold the merge turn (fleet turn holds);
#   - a heavy command the fleet config declares must run under `fleet with-lock`.
#
# Project config: .claude/gates.json in the work tree (fields documented at load_config below).
# Fast: no network except on `gh pr merge`. It never denies on its own errors: those are logged to
# ${GATE_LOG:-$HOME/.claude/hooks/gate.log} and the call is allowed. Never exits 2.
# Needs jq. Bash 3.2 compatible. `--self-test` feeds it sample hook JSON.
set -u

LOG=${GATE_LOG:-$HOME/.claude/hooks/gate.log}
oops() { { printf '%s gate.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; } 2>/dev/null; exit 0; }
deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}' \
    || oops "jq failed writing a deny"
  exit 0
}

fleet_bin() {
  if [ -n "${FLEET_BIN:-}" ]; then printf '%s\n' "$FLEET_BIN"; return; fi
  local d
  for d in "$HOME/.claude/skills/queue-fleet/fleet" "$(dirname "$0")/../skills/queue-fleet/fleet"; do
    [ -x "$d" ] && { printf '%s\n' "$d"; return; }
  done
}

# Quoted strings become Q, so separators and words inside a message never count.
unquote() { printf '%s' "$1" | tr '\n' ';' | sed -e "s/'[^']*'/Q/g" -e 's/"[^"]*"/Q/g'; }

# Print each simple command on its own line.
segments() { printf '%s' "$1" | sed -e 's/&&/;/g' -e 's/||/;/g' -e 's/[|&()]/;/g' | tr ';' '\n'; }

# Split a segment into words; strip leading VAR=value assignments (kept in ENV_HOME when HOME=)
# and wrappers (command, env, exec, sudo-less).
WORDS=(); ENV_HOME=""
parse_segment() {
  local seg=$1 w
  set -f; WORDS=($seg); set +f
  ENV_HOME=""
  while [ ${#WORDS[@]} -gt 0 ]; do
    w=${WORDS[0]}
    case "$w" in
      HOME=*) ENV_HOME=${w#HOME=}; WORDS=("${WORDS[@]:1}") ;;
      [A-Za-z_]*=*) WORDS=("${WORDS[@]:1}") ;;
      command|env|exec|time|nohup) WORDS=("${WORDS[@]:1}") ;;
      *) break ;;
    esac
  done
}
base() { local w=${1##*/}; printf '%s' "$w"; }

# For a git segment: GIT_SUB = subcommand, GIT_REST = its arguments, GIT_EMAIL = -c user.email.
GIT_SUB=""; GIT_REST=(); GIT_EMAIL=""
parse_git() {
  local i=1 n=${#WORDS[@]} w
  GIT_SUB=""; GIT_REST=(); GIT_EMAIL=""
  while [ $i -lt $n ]; do
    w=${WORDS[$i]}
    case "$w" in
      -C|-c|--git-dir|--work-tree|--namespace)
        if [ "$w" = "-c" ]; then case "${WORDS[$((i + 1))]:-}" in user.email=*) GIT_EMAIL=${WORDS[$((i + 1))]#user.email=} ;; esac; fi
        i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) GIT_SUB=$w; GIT_REST=("${WORDS[@]:$((i + 1))}"); return 0 ;;
    esac
  done
}

check_git() {
  local cwd=$1 a
  case "$GIT_SUB" in
    stash)
      case "${GIT_REST[0]:-}" in list|show) return 0 ;; esac
      deny "git stash is refused: stash/pop on a clean tree pops an unrelated entry. Commit a WIP instead (git commit -m wip), or use a separate worktree." ;;
    push)
      for a in ${GIT_REST[@]+"${GIT_REST[@]}"}; do
        case "$a" in
          --force|--force=*|--force-with-lease|--force-with-lease=*|--force-if-includes|-f|-[a-zA-Z]*f*) [ "$a" = "--follow-tags" ] || \
            deny "git push with force ($a) is refused: ask the user first." ;;
          +*) deny "git push with a +refspec ($a) is a force push and is refused: ask the user first." ;;
        esac
      done ;;
    rebase)
      case "${GIT_REST[0]:-}" in --abort|--quit) return 0 ;; esac
      deny "git rebase is refused: ask the user first. To bring a branch up to date, merge main into it." ;;
    commit)
      [ -n "$GIT_EMAIL" ] && return 0
      local email
      if [ -n "$ENV_HOME" ]; then
        email=$(cd "$cwd" 2>/dev/null && HOME=$ENV_HOME git config user.email 2>/dev/null)
      else
        email=$(cd "$cwd" 2>/dev/null && git config user.email 2>/dev/null)
      fi
      [ -n "$email" ] || deny "git commit is refused: no user.email is set${ENV_HOME:+ under HOME=$ENV_HOME} — the commit would carry an unlinked author. Set HOME per command only for the tool that needs it, or pass -c user.email=<address>." ;;
  esac
  return 0
}

# --- the project's forge and verification config --------------------------------------------------
# .claude/gates.json in the work tree (all fields optional):
#   forge          github | gitlab | other | none   (default: github when origin is on github.com,
#                  none when there is no remote, else unknown → the forge gate is skipped, logged)
#   default_branch the branch merges land on (default: origin/HEAD, else main or master)
#   ci             true | false   (default: true for github; for other forges, true iff checks_cmd is set)
#   merge_cmd      ERE matching the forge's merge command (github default: ^gh pr merge)
#   sha_flag       the merge command's flag binding the merged head (github default: --match-head-commit)
#   head_cmd       shell, prints the change's head sha; $PR is the change number
#   checks_cmd     shell, prints JSON [{"name","bucket"}] with bucket pass|fail|pending|skipping|cancel
#   required_checks names that must pass (default: every listed check passes or is skipped)
#   verify_cmd     the complete local suite command; a verified stamp must have been made by it
CFG=""
load_config() { # cwd
  local top
  top=$(cd "$1" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -f "$top/.claude/gates.json" ] || return 0
  if jq -e 'type == "object"' "$top/.claude/gates.json" >/dev/null 2>&1; then CFG="$top/.claude/gates.json"
  else log "unparsable $top/.claude/gates.json; using defaults"; fi
}
# has(), not //: jq's // treats false as absent, so a configured "ci": false would fall back to the default.
cfg() { [ -n "$CFG" ] && jq -r --arg k "$1" 'if has($k) and .[$k] != null then .[$k] | if type == "array" then .[] else tostring end else empty end' "$CFG" 2>/dev/null; }
log() { { printf '%s gate.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; } 2>/dev/null; }

FORGE=""
detect_forge() { # cwd
  FORGE=$(cfg forge)
  [ -n "$FORGE" ] && return 0
  local url
  url=$(cd "$1" 2>/dev/null && git remote get-url origin 2>/dev/null)
  if [ -z "$url" ] && [ -z "$(cd "$1" 2>/dev/null && git remote 2>/dev/null)" ]; then FORGE=none
  else case "$url" in *github.com[:/]*) FORGE=github ;; *) FORGE=unknown ;; esac; fi
}
forge_default() { # key
  [ "$FORGE" = "github" ] || return 0
  case "$1" in
    merge_cmd)  echo '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' ;;
    sha_flag)   echo '--match-head-commit' ;;
    head_cmd)   echo 'gh pr view "$PR" $REPO_FLAG --json headRefOid -q .headRefOid' ;;
    checks_cmd) echo 'gh pr checks "$PR" $REPO_FLAG --json name,bucket' ;;
    ci)         echo true ;;
  esac
}
setting() { local v; v=$(cfg "$1"); [ -n "$v" ] && { printf '%s\n' "$v"; return; }; forge_default "$1"; }

stamp_ok() { # cwd sha → 0 when a verified stamp exists (made by verify_cmd, if one is configured)
  local g f want
  g=$(cd "$1" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  f="$g/verified/$2"
  [ -f "$f" ] || return 1
  want=$(cfg verify_cmd)
  [ -z "$want" ] || [ "$(head -1 "$f")" = "$want" ]
}
need_stamp() { # cwd sha what
  stamp_ok "$1" "$2" && return 0
  local how; how=$(cfg verify_cmd); how=${how:-<the complete local suites>}
  deny "$3 is refused: $2 has no verified stamp — the complete local suites have not passed on that exact head. Run delivery/verify-head -- $how on it first."
}

# A forge merge: the merged head must be the reviewed head, and every verification must pass on it.
check_forge_merge() { # cwd
  local cwd=$1 i=1 n=${#WORDS[@]} w pr="" sha="" repo="" shaflag
  shaflag=$(setting sha_flag)
  # skip the words the merge pattern itself matched: the shortest prefix of words that matches it
  local re; re=$(setting merge_cmd); i=1
  while [ $i -le $n ] && ! printf '%s' "${WORDS[*]:0:$i}" | grep -Eq -- "$re"; do i=$((i + 1)); done
  while [ $i -lt $n ]; do
    w=${WORDS[$i]}
    if [ -n "$shaflag" ] && [ "$w" = "$shaflag" ]; then sha=${WORDS[$((i + 1))]:-}; i=$((i + 2)); continue; fi
    if [ -n "$shaflag" ]; then case "$w" in "$shaflag"=*) sha=${w#*=}; i=$((i + 1)); continue ;; esac; fi
    case "$w" in
      -R|--repo) repo=${WORDS[$((i + 1))]:-}; i=$((i + 2)); continue ;;
      --repo=*) repo=${w#*=} ;;
      -t|--subject|-b|--body|-F|--body-file|-A|--author-email|-m|--message) i=$((i + 2)); continue ;;
      -*) ;;
      *) [ -z "$pr" ] && pr=$w ;;
    esac
    i=$((i + 1))
  done
  case "$pr" in */pull/*|*/merge_requests/*|*/pulls/*) pr=${pr%%[?#]*}; pr=${pr%/}; pr=${pr##*/} ;; esac
  case "$pr" in ""|*[!0-9]*) deny "the merge is refused: name the change by number (or URL) so the gate can check its head and checks." ;; esac
  if [ -n "$shaflag" ]; then
    printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' \
      || deny "the merge is refused: pass $shaflag <the full 40-hex head sha> you verified, so a push after your check cannot be merged."
  else
    log "forge $FORGE: no sha_flag configured, so the merged head cannot be pinned; checking the current head"
  fi
  local head_cmd head
  head_cmd=$(setting head_cmd)
  [ -n "$head_cmd" ] || oops "forge $FORGE: no head_cmd configured; merge allowed unchecked"
  head=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} sh -c "$head_cmd" 2>/dev/null) || oops "head_cmd for $pr failed; allowing"
  printf '%s' "$head" | grep -Eq '^[0-9a-f]{40}$' || oops "head_cmd for $pr printed '$head', not a sha; allowing"
  if [ -n "$sha" ] && [ "$head" != "$sha" ]; then
    deny "the merge is refused: change $pr's head is $head, not $sha. Verify the new head first."
  fi
  sha=$head
  local ci; ci=$(setting ci); [ -n "$ci" ] || { [ -n "$(cfg checks_cmd)" ] && ci=true || ci=false; }
  if [ "$ci" != "true" ]; then
    need_stamp "$cwd" "$sha" "the merge of change $pr"; return 0
  fi
  local checks_cmd checks
  checks_cmd=$(setting checks_cmd)
  [ -n "$checks_cmd" ] || oops "forge $FORGE: ci is on but no checks_cmd is configured; merge allowed unchecked"
  # gh exits nonzero when a check failed or is pending, yet still prints the JSON.
  checks=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} sh -c "$checks_cmd" 2>/dev/null)
  if ! printf '%s' "$checks" | jq -e 'type == "array"' >/dev/null 2>&1; then
    [ -z "$checks" ] && deny "the merge is refused: change $pr reports no checks at $sha. Wait for CI (delivery/wait-pr-ci)."
    oops "checks_cmd for $pr printed no JSON array; allowing"
  fi
  [ "$(printf '%s' "$checks" | jq length)" -gt 0 ] || deny "the merge is refused: change $pr reports no checks at $sha. Wait for CI (delivery/wait-pr-ci)."
  local req bad
  req=$(cfg required_checks)
  if [ -n "$req" ]; then
    bad=$(printf '%s\n' "$req" | jq -R . | jq -s --argjson c "$checks" -r \
      '.[] as $n | ([$c[] | select(.name == $n)] | if length == 0 then "\($n): missing" elif all(.bucket == "pass") then empty else "\($n): \(map(.bucket) | join("/"))" end)')
  else
    bad=$(printf '%s' "$checks" | jq -r '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.bucket)"')
  fi
  [ -z "$bad" ] || deny "the merge is refused: not every required check passes at $sha — $(printf '%s' "$bad" | tr '\n' ';' | sed 's/;$//; s/;/; /g'). Wait with delivery/wait-pr-ci, or fix the red."
  return 0
}

default_branch() { # cwd
  local b; b=$(cfg default_branch); [ -n "$b" ] && { echo "$b"; return; }
  b=$(cd "$1" 2>/dev/null && git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null) && { echo "${b#origin/}"; return; }
  for b in main master; do (cd "$1" && git show-ref -q --verify "refs/heads/$b") 2>/dev/null && { echo "$b"; return; }; done
}

# A local merge into the default branch (no forge): the merged head must carry a verified stamp.
check_local_merge() { # cwd → sets LOCAL_MERGE when gated
  local cwd=$1 cur def a target=""
  case "${GIT_REST[0]:-}" in --abort|--continue|--quit) return 0 ;; esac
  cur=$(cd "$cwd" 2>/dev/null && git symbolic-ref -q --short HEAD 2>/dev/null) || return 0
  def=$(default_branch "$cwd"); [ -n "$def" ] || { log "no default branch found; local merge not gated"; return 0; }
  [ "$cur" = "$def" ] || return 0
  LOCAL_MERGE=1
  for a in ${GIT_REST[@]+"${GIT_REST[@]}"}; do
    case "$a" in -m|-F|-s|-X) ;; -*) ;; *) target=$a; break ;; esac
  done
  [ -n "$target" ] || { log "local merge with no target on $def; not gated"; return 0; }
  # Syncing the default branch from a remote (git merge origin/main) is not landing a change.
  case "$(cd "$cwd" 2>/dev/null && git rev-parse --symbolic-full-name "$target" 2>/dev/null)" in
    refs/remotes/*) return 0 ;;
  esac
  local sha
  sha=$(cd "$cwd" 2>/dev/null && git rev-parse --verify -q "$target^{commit}" 2>/dev/null) || oops "cannot resolve merge target '$target'; allowing"
  need_stamp "$cwd" "$sha" "git merge of $target into $def"
}

main() {
  command -v jq >/dev/null 2>&1 || oops "jq missing; allowing"
  local input cmd cwd flat seg
  input=$(cat) || oops "no stdin"
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || oops "unparsable hook input"
  [ -n "$cmd" ] || exit 0
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}
  flat=$(unquote "$cmd")

  local fleet_state="" gcd
  gcd=$(cd "$cwd" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -d "$gcd/fleet" ] && fleet_state="$gcd/fleet"

  load_config "$cwd"; detect_forge "$cwd"
  local merge_seen="" merge_re
  merge_re=$(setting merge_cmd)
  [ -n "$merge_re" ] || [ "$FORGE" = "none" ] || [ "$FORGE" = "unknown" ] || log "forge $FORGE has no merge_cmd configured; forge merges are not gated"
  while IFS= read -r seg; do
    parse_segment "$seg"
    [ ${#WORDS[@]} -gt 0 ] || continue
    if [ -n "$merge_re" ] && printf '%s' "${WORDS[*]}" | grep -Eq -- "$merge_re"; then
      merge_seen=1; check_forge_merge "$cwd"; continue
    fi
    case "$(base "${WORDS[0]}")" in
      git)
        parse_git; check_git "$cwd"
        if [ "$GIT_SUB" = "merge" ] && { [ "$FORGE" = "none" ] || { [ "$FORGE" = "unknown" ] && [ -z "$CFG" ]; }; }; then
          LOCAL_MERGE=""; check_local_merge "$cwd"; [ -n "$LOCAL_MERGE" ] && merge_seen=1
        fi ;;
    esac
  done <<EOF
$(segments "$flat")
EOF

  if [ -n "$fleet_state" ]; then
    if [ -n "$merge_seen" ]; then
      local fb; fb=$(fleet_bin)
      [ -n "$fb" ] || oops "fleet state exists but no fleet script found; allowing the merge"
      (cd "$cwd" && "$fb" turn holds) >/dev/null 2>&1 \
        || deny "the merge is refused: this slot does not hold the merge turn. Use fleet turn enter, then fleet turn wait."
    fi
    if ! printf '%s' "$flat" | grep -Eq "(^|[;&|(/[:space:]])fleet[[:space:]]+with-lock[[:space:]]"; then
      local p
      while IFS= read -r p; do
        [ -n "$p" ] || continue
        printf '%s' "$flat" | grep -Eq -- "$p" \
          && deny "this is a declared heavy command (/$p/) and must run under the suite lock: use fleet with-lock suite -- <command>."
      done <<EOF
$(jq -r '.heavy_commands[]?.pattern // empty' "$fleet_state/config.json" 2>/dev/null)
EOF
    fi
  fi
  exit 0
}

self_test() {
  local self tmp fails=0 out
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/gate-self.XXXXXX"); tmp=$(cd "$tmp" && pwd -P)
  export GATE_LOG="$tmp/gate.log"
  (cd "$tmp" && git init -q repo && git init -q fleetrepo && git init -q noemail && git init -q -b main local && git init -q glrepo) || return 1
  local r
  for r in repo fleetrepo local glrepo; do git -C "$tmp/$r" config user.email t@example.invalid; git -C "$tmp/$r" config user.name t; done
  git -C "$tmp/repo" remote add origin https://github.com/o/r.git
  git -C "$tmp/fleetrepo" remote add origin git@github.com:o/r.git
  git -C "$tmp/glrepo" remote add origin https://gitlab.example.com/o/r.git
  # A local-only repo: main plus a feature branch, merged by git merge.
  ( cd "$tmp/local" && echo a > f && git add f && git commit -qm a && git checkout -q -b feat \
    && echo b > f && git commit -qam b && git checkout -q main ) || return 1
  local FEAT; FEAT=$(git -C "$tmp/local" rev-parse feat)
  mkdir -p "$tmp/home" "$tmp/fleetrepo/.git/fleet" "$tmp/bin"
  printf '{"heavy_commands":[{"pattern":"cargo[[:space:]]+(test|nextest)","bound_seconds":10}]}\n' > "$tmp/fleetrepo/.git/fleet/config.json"
  printf '#!/bin/sh\n[ "$1 $2" = "turn holds" ] && [ "${HOLDS:-0}" = 1 ]\n' > "$tmp/fakefleet"; chmod +x "$tmp/fakefleet"
  # Stand-ins on PATH. gh: GH_HEAD is the PR head, GH_CHECKS the checks JSON, GH_FAIL=1 a network
  # failure. forgecli: a non-GitHub forge's CLI the glrepo config points at.
  printf '#!/bin/sh\ncase "$1" in head) echo "$GH_HEAD" ;; checks) echo "$GH_CHECKS" ;; esac\n' > "$tmp/bin/forgecli"; chmod +x "$tmp/bin/forgecli"
  mkdir -p "$tmp/glrepo/.claude"
  printf '%s\n' '{"forge":"gitlab","merge_cmd":"^forgecli merge","sha_flag":"--sha","head_cmd":"forgecli head $PR","checks_cmd":"forgecli checks $PR","ci":true}' > "$tmp/glrepo/.claude/gates.json"
  cat > "$tmp/bin/gh" <<'EOF'
#!/bin/sh
[ "${GH_FAIL:-0}" = 1 ] && exit 1
case "$1 $2" in
  "pr view")   echo "$GH_HEAD" ;;
  "pr checks") printf '%s\n' "$GH_CHECKS"; echo "$GH_CHECKS" | grep -q '"pass"' || exit 8 ;;
esac
EOF
  chmod +x "$tmp/bin/gh"
  local SHA=0123456789abcdef0123456789abcdef01234567 OTHER=fedcba9876543210fedcba9876543210fedcba98
  local GREEN='[{"name":"ci","bucket":"pass"},{"name":"lint","bucket":"skipping"}]'
  local PENDING='[{"name":"ci","bucket":"pending"}]'
  run() { # dir command [VAR=val...]
    local d=$1 c=$2; shift 2
    jq -n --arg c "$c" --arg d "$d" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' \
      | env PATH="$tmp/bin:$PATH" FLEET_BIN="$tmp/fakefleet" HOME="$tmp/home" GH_HEAD=$SHA GH_CHECKS="$GREEN" "$@" bash "$self"
  }
  denies() { local name=$1 want=$2; shift 2; out=$(run "$@"); if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 && printf '%s' "$out" | grep -q -- "$want"; then echo "ok   $name"; else echo "FAIL $name: ${out:-<allowed>}"; fails=$((fails + 1)); fi; }
  allows() { local name=$1 st; shift; out=$(run "$@" 2>&1); st=$?; [ "$st" -eq 0 ] && [ -z "$out" ] && echo "ok   $name" || { echo "FAIL $name (exit $st): $out"; fails=$((fails + 1)); }; }
  R="$tmp/repo"; F="$tmp/fleetrepo"
  # stash
  denies "git stash is denied"                  "unrelated entry" "$R" "git stash"
  denies "git stash pop after && is denied"     "unrelated entry" "$R" "git add . && git stash pop"
  denies "git -C dir stash push is denied"      "unrelated entry" "$R" "git -C sub stash push -m x"
  allows "git stash list is allowed"            "$R" "git stash list"
  allows "git stash show is allowed"            "$R" "git stash show -p"
  allows "a quoted mention of git stash"        "$R" "git commit -m 'no; git stash here'"
  # push / rebase
  denies "git push --force"                     "ask the user" "$R" "git push --force origin x"
  denies "git push -f"                          "ask the user" "$R" "git push -f"
  denies "git push -uf (combined flags)"        "ask the user" "$R" "git push -uf origin x"
  denies "git push --force-with-lease"          "ask the user" "$R" "git push --force-with-lease"
  denies "git push +refspec"                    "ask the user" "$R" "git push origin +x:x"
  allows "git push -u origin x"                 "$R" "git push -u origin x"
  allows "git push --follow-tags"               "$R" "git push --follow-tags"
  denies "git rebase"                           "ask the user" "$R" "git rebase origin/main"
  allows "git rebase --abort"                   "$R" "git rebase --abort"
  # commit author
  allows "git commit with user.email set"       "$R" "git commit -m x"
  denies "git commit under a scratch HOME with no email" "no user.email" "$tmp/noemail" "HOME=$tmp/home git commit -m x"
  allows "git commit -c user.email=… is allowed" "$tmp/noemail" "git -c user.email=a@b.c commit -m x"
  # merge
  allows "merge: sha matches, checks green"     "$R" "gh pr merge 12 --squash --match-head-commit $SHA"
  allows "merge: --match-head-commit= and a URL" "$R" "gh pr merge https://github.com/o/r/pull/12 --match-head-commit=$SHA"
  denies "merge: no --match-head-commit"        "match-head-commit" "$R" "gh pr merge 12 --squash"
  denies "merge: a short sha"                   "40-hex" "$R" "gh pr merge 12 --match-head-commit 0123abc"
  denies "merge: no PR number"                  "by number" "$R" "gh pr merge --squash --match-head-commit $SHA"
  denies "merge: head moved"                    "not $SHA" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_HEAD=$OTHER
  denies "merge: a check pending"               "ci: pending" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS="$PENDING"
  denies "merge: no checks at all"              "no checks" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS="[]"
  mkdir -p "$R/.claude"; printf '{"required_checks":["ci","cla"]}\n' > "$R/.claude/gates.json"
  denies "merge: a required check missing"      "cla: missing" "$R" "gh pr merge 12 --match-head-commit $SHA"
  printf '{"required_checks":["ci"]}\n' > "$R/.claude/gates.json"
  allows "merge: only the required checks count" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"flaky","bucket":"fail"}]'
  printf '{"forge":"github","ci":false}\n' > "$R/.claude/gates.json"
  denies "github with \"ci\": false: a merge wants a stamp, not checks" "verify-head" "$R" "gh pr merge 12 --match-head-commit $SHA"
  mkdir -p "$R/.git/verified"; printf 'x\nt\n' > "$R/.git/verified/$SHA"
  allows "github with \"ci\": false: a stamped head merges" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS="$PENDING"
  rm -rf "$R/.git/verified"
  rm -rf "$R/.claude"
  allows "merge: a gh failure is logged and allowed" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FAIL=1
  grep -q "head_cmd for 12 failed" "$GATE_LOG" && echo "ok   the gh failure was logged" || { echo "FAIL the gh failure was logged"; fails=$((fails + 1)); }
  # a configured non-GitHub forge
  G="$tmp/glrepo"
  allows "other forge: sha pinned, checks green"   "$G" "forgecli merge 7 --sha $SHA"
  denies "other forge: no sha"                     "--sha" "$G" "forgecli merge 7"
  denies "other forge: a red check"                "ci: fail" "$G" "forgecli merge 7 --sha $SHA" GH_CHECKS='[{"name":"ci","bucket":"fail"}]'
  allows "other forge: gh is not its merge command" "$G" "gh pr merge 7"
  # a forge with no CI: the stamp is the evidence
  printf '%s\n' '{"forge":"gitlab","merge_cmd":"^forgecli merge","sha_flag":"--sha","head_cmd":"forgecli head $PR","ci":false}' > "$G/.claude/gates.json"
  denies "no CI: a merge without a stamp"          "verify-head" "$G" "forgecli merge 7 --sha $SHA"
  mkdir -p "$G/.git/verified"; printf 'make test\n2026-01-01T00:00:00Z\n' > "$G/.git/verified/$SHA"
  allows "no CI: a stamped head merges"            "$G" "forgecli merge 7 --sha $SHA"
  # an unconfigured unknown forge: logged, not denied
  rm -rf "$G/.claude"
  allows "unknown forge, no config: its merges are not gated" "$G" "forgecli merge 7"
  # no remote at all: a local merge into the default branch needs a stamp
  L="$tmp/local"
  denies "no remote: git merge into main without a stamp" "no verified stamp" "$L" "git merge --no-ff feat"
  denies "no remote: git merge --squash too"       "no verified stamp" "$L" "git merge --squash feat"
  mkdir -p "$L/.git/verified"; printf 'x\nt\n' > "$L/.git/verified/$FEAT"
  allows "no remote: a stamped head merges"        "$L" "git merge --ff-only feat"
  printf '%s\n' '{"verify_cmd":"make check"}' > "$L/.git/../.gates-tmp"; mkdir -p "$L/.claude"; mv "$L/.gates-tmp" "$L/.claude/gates.json"
  denies "no remote: a stamp from another command" "make check" "$L" "git merge feat"
  rm -rf "$L/.claude"
  allows "no remote: git merge --abort"            "$L" "git merge --abort"
  git -C "$L" checkout -q feat
  allows "no remote: merging main into a feature branch" "$L" "git merge main"
  git -C "$L" checkout -q main
  # fleet
  denies "fleet: merge outside the turn"        "fleet turn enter" "$F" "gh pr merge 12 --match-head-commit $SHA"
  allows "fleet: merge inside the turn"         "$F" "gh pr merge 12 --match-head-commit $SHA" HOLDS=1
  denies "fleet: heavy command outside the lock" "fleet with-lock" "$F" "cargo test -p core"
  allows "fleet: heavy command under the lock"  "$F" "fleet with-lock suite -- cargo test -p core"
  allows "no fleet: heavy command allowed"      "$R" "cargo test -p core"
  # robustness
  out=$(printf 'garbage' | GATE_LOG="$tmp/gate.log" bash "$self"); [ -z "$out" ] && echo "ok   garbage input allows silently" || { echo "FAIL garbage input"; fails=$((fails + 1)); }
  allows "a non-repo cwd allows ordinary commands" "/" "ls -la"
  rm -rf "$tmp"
  [ "$fails" -eq 0 ] && { echo "self-test: all passed"; return 0; }
  echo "self-test: $fails failed"; return 1
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
main
