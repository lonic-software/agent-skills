#!/usr/bin/env bash
# gate.sh — PreToolUse hook (matcher "Bash"): the hard gates, as code, for every session in any repo.
#
# Always:
#   - The merge gate: the merged head is exactly the reviewed head, and every verification the
#     project has passed on that head. A forge merge (the config's merge_cmd; `gh pr merge` built in
#     when origin is on github.com, `glab mr merge` on gitlab.com or with "forge": "gitlab") must pin the head (sha_flag, e.g. --match-head-commit <sha>),
#     that sha must be the change's head (head_cmd), and the evidence must pass at it: the CI checks
#     (checks_cmd: every listed check passes or is skipping, and every name in required_checks is
#     listed and passes) when the project has CI, otherwise a verified stamp (delivery/verify-head).
#     With no forge — no remote, or forge "none" — a local `git merge` into the default branch needs
#     a verified stamp for the merged head. A forge the gate cannot recognise, unconfigured, is not
#     gated at the forge; it is logged instead (a remote-tracking sync merge is never gated).
#   - A merge whose change touches a protected path is refused: the user merges it. Always
#     .claude/gates.json and .claude/fleet.json, plus the protected_paths globs of the default
#     branch's gates.json (never the change's own copy, which the change can rewrite).
#   - `git stash` is denied (except `list` and `show`): stash/pop on a clean tree pops an unrelated entry.
#   - `git push --force` / `-f` / `--force-with-lease` / a `+refspec`, and `git rebase`: ask the user first.
#   - `git commit` with no user.email at all (a scratch HOME, an unconfigured box): the commit would
#     carry an unlinked author. With commit_email configured, a commit whose author email (-c
#     user.email, GIT_AUTHOR_EMAIL=, --author, else git config) differs is refused, best-effort,
#     and a `git push` carrying a commit authored by another email is refused, authoritatively.
# Only while $(git rev-parse --git-common-dir)/fleet/ exists (queue-fleet):
#   - a forge merge also needs this slot to hold the merge turn (fleet turn holds), the pinned sha
#     to be this slot's HEAD, and `fleet collisions` to pass on it (no counter both sides bumped);
#   - a heavy command the fleet config declares must run under `fleet with-lock`.
#
# Project config: .claude/gates.json in the work tree (fields documented at load_config below).
# Fast: no network except on a forge merge. It never denies on its own errors: those are logged to
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

# A value the unquoting turned into Q, recovered from the raw command: the KEY=value there,
# quotes stripped. Best-effort: with two different quoted values for one key, the last wins.
RAW_CMD=""
unq() { # key value
  [ "$2" = "Q" ] || { printf '%s' "$2"; return; }
  printf '%s' "$RAW_CMD" | tr '\n' ' ' | sed -n -E "s/.*$1=[\"']([^\"']*)[\"'].*/\\1/p" | head -1
}

# Split a segment into words; strip leading VAR=value assignments (kept in ENV_HOME when HOME=,
# ENV_AUTHOR when GIT_AUTHOR_EMAIL=) and wrappers (command, env, exec, sudo-less).
WORDS=(); ENV_HOME=""; ENV_AUTHOR=""
parse_segment() {
  local seg=$1 w
  set -f; WORDS=($seg); set +f
  ENV_HOME=""; ENV_AUTHOR=""
  while [ ${#WORDS[@]} -gt 0 ]; do
    w=${WORDS[0]}
    case "$w" in
      HOME=*) ENV_HOME=${w#HOME=}; WORDS=("${WORDS[@]:1}") ;;
      GIT_AUTHOR_EMAIL=*) ENV_AUTHOR=$(unq GIT_AUTHOR_EMAIL "${w#GIT_AUTHOR_EMAIL=}"); WORDS=("${WORDS[@]:1}") ;;
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
        if [ "$w" = "-c" ]; then case "${WORDS[$((i + 1))]:-}" in user.email=*) GIT_EMAIL=$(unq 'user\.email' "${WORDS[$((i + 1))]#user.email=}") ;; esac; fi
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
      done
      local want; want=$(cfg commit_email)
      [ -z "$want" ] || check_push_authors "$cwd" "$want" ;;
    rebase)
      case "${GIT_REST[0]:-}" in --abort|--quit) return 0 ;; esac
      deny "git rebase is refused: ask the user first. To bring a branch up to date, merge main into it." ;;
    commit)
      local email=$GIT_EMAIL want
      [ -n "$email" ] || email=$ENV_AUTHOR
      if [ -z "$email" ]; then
        for a in ${GIT_REST[@]+"${GIT_REST[@]}"}; do
          case "$a" in --author=*|--author) email=$(printf '%s' "$RAW_CMD" | tr '\n' ' ' | sed -n -E 's/.*--author[= ]+[^<;&|]*<([^>]*)>.*/\1/p' | head -1) ;; esac
        done
      fi
      if [ -z "$email" ]; then
        if [ -n "$ENV_HOME" ]; then
          email=$(cd "$cwd" 2>/dev/null && HOME=$ENV_HOME git config user.email 2>/dev/null)
        else
          email=$(cd "$cwd" 2>/dev/null && git config user.email 2>/dev/null)
        fi
      fi
      [ -n "$email" ] || deny "git commit is refused: no user.email is set${ENV_HOME:+ under HOME=$ENV_HOME} — the commit would carry an unlinked author. Set HOME per command only for the tool that needs it, or pass -c user.email=<address>."
      want=$(cfg commit_email)
      [ -z "$want" ] || [ "$email" = "$want" ] \
        || deny "git commit is refused: its author email would be $email, not the project's commit_email $want (.claude/gates.json). Set it in the repository's own config (git config user.email $want), or drop the override." ;;
  esac
  return 0
}

# git push: every commit it would publish (reachable from what it pushes, on no remote-tracking ref
# yet) must be authored by the project's commit_email.
check_push_authors() { # cwd want
  local cwd=$1 want=$2 i=0 n=${#GIT_REST[@]} a remote="" srcs=() src bad
  while [ $i -lt $n ]; do
    a=${GIT_REST[$i]}
    case "$a" in
      --repo|-o|--push-option|--receive-pack|--exec) i=$((i + 2)); continue ;;
      --all|--branches|--mirror) srcs+=(--branches) ;;
      -*) ;;
      *) if [ -z "$remote" ]; then remote=$a
         else src=${a#+}; src=${src%%:*}; [ -n "$src" ] && srcs+=("$src"); fi ;;
    esac
    i=$((i + 1))
  done
  [ ${#srcs[@]} -gt 0 ] || srcs=(HEAD)
  bad=$(cd "$cwd" 2>/dev/null && git log --format='%h %ae' "${srcs[@]}" --not --remotes -- 2>/dev/null | awk -v w="$want" '$2 != w' | head -5)
  [ -z "$bad" ] || deny "git push is refused: it would publish commits not authored by the project's commit_email $want (.claude/gates.json): $(printf '%s' "$bad" | tr '\n' ';' | sed 's/;$//; s/;/; /g'). Set git config user.email $want, then re-author them (git commit --amend --reset-author for the last one; ask the user before rewriting more)."
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
#   files_cmd      shell, prints the change's changed paths, one per line (github and gitlab built in)
#   required_checks names that must be listed and pass, on top of the rule that every listed check
#                  passes or is skipping: a forge lists only the checks that have registered, so a
#                  required check that has not started yet would otherwise go unnoticed
#   protected_paths globs (bash case patterns) a session never merges; read from the default
#                  branch's copy of this file, on top of .claude/gates.json and .claude/fleet.json
#   commit_email   the author email every commit and push must carry
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
# required_checks as a JSON array of strings ([] when unset).
required_json() {
  local j=""
  [ -n "$CFG" ] && j=$(jq -c '.required_checks // [] | if type == "array" then map(tostring) else [tostring] end' "$CFG" 2>/dev/null)
  printf '%s\n' "${j:-[]}"
}
log() { { printf '%s gate.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; } 2>/dev/null; }

# The default branch's copy of the config, never the work tree's: a change can rewrite its own.
# Prints the protected globs, the two hardcoded ones first.
protected_globs() { # cwd
  local def ref
  printf '%s\n' .claude/gates.json .claude/fleet.json
  def=$(default_branch "$1"); [ -n "$def" ] || { log "no default branch; only the built-in protected paths apply"; return 0; }
  for ref in "refs/remotes/origin/$def" "refs/heads/$def"; do
    if (cd "$1" 2>/dev/null && git rev-parse -q --verify "$ref" >/dev/null 2>&1); then
      (cd "$1" 2>/dev/null && git show "$ref:.claude/gates.json" 2>/dev/null) \
        | jq -r '.protected_paths // [] | if type == "array" then .[] else . end | tostring' 2>/dev/null
      return 0
    fi
  done
}
# Deny when one of the changed paths (stdin, one per line) matches a protected glob.
deny_protected() { # cwd what
  local globs f g hit=""
  globs=$(protected_globs "$1")
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    while IFS= read -r g; do
      [ -n "$g" ] || continue
      # shellcheck disable=SC2254 — g is a glob on purpose
      case "$f" in $g) hit="$hit, $f"; break ;; esac
    done <<EOF
$globs
EOF
  done
  [ -z "$hit" ] || deny "$2 is refused: it touches ${hit#, }, a protected path. The user merges this one; tell them it is ready."
  return 0
}

# The GitLab preset (origin on gitlab.com, or "forge": "gitlab" for a self-hosted instance), run
# with sh -c, $PR the merge request's iid and $GL_PROJECT the URL-encoded project path (glab's
# :fullpath, the current repository, when unset). The checks are the head pipeline, as one entry
# named "pipeline" whose status is the verdict, plus its jobs by name; a pipeline for an older sha,
# or none yet, is pending or no checks, never green. A job failed with allow_failure is "skipping",
# as GitLab itself passes the pipeline over it; a pipeline waiting on a manual job is pending.
GL_HEAD_CMD='glab api "projects/${GL_PROJECT:-:fullpath}/merge_requests/$PR" | jq -er .sha'
GL_FILES_CMD='glab api --paginate "projects/${GL_PROJECT:-:fullpath}/merge_requests/$PR/diffs?per_page=100" | jq -r ".[] | .old_path, .new_path"'
GL_CHECKS_CMD=
IFS= read -r -d '' GL_CHECKS_CMD <<'EOF' || true
mr=$(glab api "projects/${GL_PROJECT:-:fullpath}/merge_requests/$PR") || exit 1
p=$(printf '%s' "$mr" | jq -er 'if .head_pipeline == null then "none" elif .head_pipeline.sha != .sha then "stale" else .head_pipeline.id end') || exit 1
case $p in
  none)  echo '[]' ;;
  stale) echo '[{"name":"pipeline","bucket":"pending"}]' ;;
  *) glab api "projects/${GL_PROJECT:-:fullpath}/pipelines/$p/jobs?per_page=100" | jq -c --argjson mr "$mr" '
       [{name: "pipeline", status: $mr.head_pipeline.status, allow_failure: false, pipe: true}]
       + map({name, status, allow_failure, pipe: false})
       | map({name, bucket: (
           if .status == "success" then "pass"
           elif .status == "failed" then (if .allow_failure then "skipping" else "fail" end)
           elif .status == "canceled" or .status == "canceling" then "cancel"
           elif .status == "skipped" then "skipping"
           elif .status == "manual" and (.pipe | not) then "skipping"
           else "pending" end)})' ;;
esac
EOF

FORGE=""
detect_forge() { # cwd
  FORGE=$(cfg forge)
  [ -n "$FORGE" ] && return 0
  local url
  url=$(cd "$1" 2>/dev/null && git remote get-url origin 2>/dev/null)
  if [ -z "$url" ] && [ -z "$(cd "$1" 2>/dev/null && git remote 2>/dev/null)" ]; then FORGE=none
  else case "$url" in *github.com[:/]*) FORGE=github ;; *gitlab.com[:/]*) FORGE=gitlab ;; *) FORGE=unknown ;; esac; fi
}
forge_default() { # key
  case "$FORGE:$1" in
    github:merge_cmd)  echo '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' ;;
    github:sha_flag)   echo '--match-head-commit' ;;
    github:head_cmd)   echo 'gh pr view "$PR" $REPO_FLAG --json headRefOid -q .headRefOid' ;;
    github:checks_cmd) echo 'gh pr checks "$PR" $REPO_FLAG --json name,bucket' ;;
    github:files_cmd)  echo 'gh pr diff "$PR" $REPO_FLAG --name-only' ;;
    gitlab:merge_cmd)  echo '^glab[[:space:]]+mr[[:space:]]+merge([[:space:]]|$)' ;;
    gitlab:sha_flag)   echo '--sha' ;;
    gitlab:head_cmd)   printf '%s\n' "$GL_HEAD_CMD" ;;
    gitlab:checks_cmd) printf '%s\n' "$GL_CHECKS_CMD" ;;
    gitlab:files_cmd)  printf '%s\n' "$GL_FILES_CMD" ;;
    github:ci|gitlab:ci) echo true ;;
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
      -t|--subject|-b|--body|-F|--body-file|-A|--author-email|-m|--message|--squash-message) i=$((i + 2)); continue ;;
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
  head=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} GL_PROJECT=$(printf '%s' "$repo" | sed 's,/,%2F,g') sh -c "$head_cmd" 2>/dev/null) || oops "head_cmd for $pr failed; allowing"
  printf '%s' "$head" | grep -Eq '^[0-9a-f]{40}$' || oops "head_cmd for $pr printed '$head', not a sha; allowing"
  if [ -n "$sha" ] && [ "$head" != "$sha" ]; then
    deny "the merge is refused: change $pr's head is $head, not $sha. Verify the new head first."
  fi
  sha=$head; MERGE_SHA=$head
  local files_cmd files
  files_cmd=$(setting files_cmd)
  if [ -z "$files_cmd" ]; then
    log "forge $FORGE: no files_cmd configured; protected paths not checked for $pr"
  elif files=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} GL_PROJECT=$(printf '%s' "$repo" | sed 's,/,%2F,g') sh -c "$files_cmd" 2>/dev/null); then
    printf '%s\n' "$files" | deny_protected "$cwd" "the merge of change $pr"
  else
    log "files_cmd for $pr failed; protected paths not checked"
  fi
  local ci; ci=$(setting ci); [ -n "$ci" ] || { [ -n "$(cfg checks_cmd)" ] && ci=true || ci=false; }
  if [ "$ci" != "true" ]; then
    need_stamp "$cwd" "$sha" "the merge of change $pr"; return 0
  fi
  local checks_cmd checks
  checks_cmd=$(setting checks_cmd)
  [ -n "$checks_cmd" ] || oops "forge $FORGE: ci is on but no checks_cmd is configured; merge allowed unchecked"
  # gh exits nonzero when a check failed or is pending, yet still prints the JSON.
  checks=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} GL_PROJECT=$(printf '%s' "$repo" | sed 's,/,%2F,g') sh -c "$checks_cmd" 2>/dev/null)
  if ! printf '%s' "$checks" | jq -e 'type == "array"' >/dev/null 2>&1; then
    [ -z "$checks" ] && deny "the merge is refused: change $pr reports no checks at $sha. Wait for CI (delivery/wait-pr-ci)."
    oops "checks_cmd for $pr printed no JSON array; allowing"
  fi
  [ "$(printf '%s' "$checks" | jq length)" -gt 0 ] || deny "the merge is refused: change $pr reports no checks at $sha. Wait for CI (delivery/wait-pr-ci)."
  # Additive: every listed check passes or is skipping, AND every required name is listed and
  # passes (a skipped required check never passed). A required name listed twice must pass twice.
  local req bad
  req=$(required_json)
  bad=$(printf '%s' "$checks" | jq -r --argjson req "$req" '
    (.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.bucket)"),
    (. as $c | $req[] as $n | [$c[] | select(.name == $n)]
       | if length == 0 then "\($n): missing (a required check)"
         elif any(.bucket == "skipping") and all(.bucket == "pass" or .bucket == "skipping") then "\($n): skipping (a required check must pass)"
         else empty end)')
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
  (cd "$cwd" 2>/dev/null && git diff --name-only "$def...$sha" 2>/dev/null) | deny_protected "$cwd" "git merge of $target into $def"
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
  flat=$(unquote "$cmd"); RAW_CMD=$cmd

  local fleet_state="" gcd
  gcd=$(cd "$cwd" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -d "$gcd/fleet" ] && fleet_state="$gcd/fleet"

  load_config "$cwd"; detect_forge "$cwd"
  local merge_seen="" merge_re; MERGE_SHA=""
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
      if [ -n "$MERGE_SHA" ]; then
        local slot_head msg st
        slot_head=$(cd "$cwd" 2>/dev/null && git rev-parse HEAD 2>/dev/null)
        [ "$slot_head" = "$MERGE_SHA" ] \
          || deny "the merge is refused: it pins $MERGE_SHA, but this slot's HEAD is ${slot_head:-unborn}. Merge from the slot whose HEAD is the verified head."
        msg=$(cd "$cwd" && "$fb" collisions 2>&1); st=$?
        case $st in
          0) ;;
          3) deny "the merge is refused: $(printf '%s' "$msg" | sed 's/^fleet: refused: //' | tr '\n' ' ')" ;;
          *) log "fleet collisions exited $st ($msg); allowing" ;;
        esac
      fi
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
  (cd "$tmp" && git init -q repo && git init -q fleetrepo && git init -q noemail && git init -q -b main local && git init -q glrepo && git init -q glcom) || return 1
  local r
  for r in repo fleetrepo local glrepo glcom; do git -C "$tmp/$r" config user.email t@example.invalid; git -C "$tmp/$r" config user.name t; done
  git -C "$tmp/repo" remote add origin https://github.com/o/r.git
  git -C "$tmp/fleetrepo" remote add origin git@github.com:o/r.git
  git -C "$tmp/glrepo" remote add origin https://gitlab.example.com/o/r.git
  git -C "$tmp/glcom" remote add origin git@gitlab.com:o/r.git
  # A local-only repo: main plus a feature branch, merged by git merge.
  ( cd "$tmp/local" && echo a > f && git add f && git commit -qm a && git checkout -q -b feat \
    && echo b > f && git commit -qam b && git checkout -q main ) || return 1
  local FEAT; FEAT=$(git -C "$tmp/local" rev-parse feat)
  mkdir -p "$tmp/home" "$tmp/fleetrepo/.git/fleet" "$tmp/bin"
  printf '{"heavy_commands":[{"pattern":"cargo[[:space:]]+(test|nextest)","bound_seconds":10}]}\n' > "$tmp/fleetrepo/.git/fleet/config.json"
  # The fleet stand-in: HOLDS=1 holds the turn; COLL=<message> makes collisions refuse with it.
  cat > "$tmp/fakefleet" <<'EOF'
#!/bin/sh
case "$1 ${2:-}" in
  "turn holds") [ "${HOLDS:-0}" = 1 ] ;;
  "collisions "*) [ -z "${COLL:-}" ] || { echo "fleet: refused: $COLL" >&2; exit 3; }; echo "no collisions" ;;
  *) exit 2 ;;
esac
EOF
  chmod +x "$tmp/fakefleet"
  ( cd "$tmp/fleetrepo" && echo a > f && git add f && git commit -qm a ) || return 1
  local FSHA; FSHA=$(git -C "$tmp/fleetrepo" rev-parse HEAD)
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
  "pr diff")   [ "${GH_FILES_FAIL:-0}" = 1 ] && exit 1; printf '%s\n' "${GH_FILES:-}" | tr ',' '\n' ;;
esac
EOF
  chmod +x "$tmp/bin/gh"
  # glab: the merge request is GL_IID (default 12) of project GL_EXPECT (default glab's
  # unexpanded :fullpath); asked for any other, it answers with a different head. GL_PIPE is the
  # head pipeline's status ("none": no pipeline), GL_PIPE_SHA its sha, GL_JOBS its jobs.
  cat > "$tmp/bin/glab" <<'EOF'
#!/bin/sh
[ "$1" = api ] || exit 2
[ "$2" = --paginate ] && shift
case "$2" in
  */jobs*) printf '%s\n' "${GL_JOBS:-[]}" ;;
  */diffs*) printf '%s\n' "${GL_FILES:-[]}" ;;
  *) p=${2#projects/}; iid=${p##*/merge_requests/}; p=${p%%/merge_requests/*}
     sha=$GL_SHA
     { [ "$p" = "${GL_EXPECT:-:fullpath}" ] && [ "$iid" = "${GL_IID:-12}" ]; } || sha=ffffffffffffffffffffffffffffffffffffffff
     if [ "${GL_PIPE:-success}" = none ]; then jq -n --arg s "$sha" '{sha: $s, head_pipeline: null}'
     else jq -n --arg s "$sha" --arg ps "${GL_PIPE_SHA:-$sha}" --arg st "${GL_PIPE:-success}" \
       '{sha: $s, head_pipeline: {id: 5, sha: $ps, status: $st}}'; fi ;;
esac
EOF
  chmod +x "$tmp/bin/glab"
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
  denies "merge: an unrequired check failing still counts" "flaky: fail" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"flaky","bucket":"fail"}]'
  denies "merge: an unrequired check pending still counts" "lint: pending" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"lint","bucket":"pending"}]'
  allows "merge: required passes, the rest pass or skip" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"lint","bucket":"skipping"},{"name":"x","bucket":"pass"}]'
  denies "merge: a required check listed twice, one failing" "ci: fail" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"ci","bucket":"fail"}]'
  denies "merge: a required check skipped" "ci: skipping" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"skipping"},{"name":"x","bucket":"pass"}]'
  denies "merge: a required check missing, the rest green" "ci: missing" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"x","bucket":"pass"}]'
  printf '{"forge":"github","ci":false}\n' > "$R/.claude/gates.json"
  denies "github with \"ci\": false: a merge wants a stamp, not checks" "verify-head" "$R" "gh pr merge 12 --match-head-commit $SHA"
  mkdir -p "$R/.git/verified"; printf 'x\nt\n' > "$R/.git/verified/$SHA"
  allows "github with \"ci\": false: a stamped head merges" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS="$PENDING"
  rm -rf "$R/.git/verified"
  rm -rf "$R/.claude"
  allows "merge: a gh failure is logged and allowed" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FAIL=1
  grep -q "head_cmd for 12 failed" "$GATE_LOG" && echo "ok   the gh failure was logged" || { echo "FAIL the gh failure was logged"; fails=$((fails + 1)); }
  # protected paths: the two configs always, plus the default branch's own protected_paths
  denies "protected: a change to .claude/gates.json"  "protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES="src/a.rs,.claude/gates.json"
  denies "protected: a change to .claude/fleet.json"  "protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".claude/fleet.json"
  allows "protected: an ordinary workflow change"     "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/ci.yml,src/a.rs"
  ( cd "$R" && mkdir -p .claude && printf '{"protected_paths":["LICENSE*",".github/workflows/cla.yml"]}\n' > .claude/gates.json \
    && git add .claude/gates.json && git commit -qm base && git update-ref refs/remotes/origin/main HEAD \
    && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main ) || return 1
  denies "protected: a glob from the default branch's protected_paths" "LICENSE-MIT, a protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES="LICENSE-MIT"
  allows "protected: the default branch's list is not a prefix match" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/cla.yml.bak"
  printf '{}\n' > "$R/.claude/gates.json"
  denies "protected: the work tree dropping protected_paths does not lift it" "cla.yml, a protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/cla.yml"
  rm -rf "$R/.claude"
  allows "protected: a files_cmd failure is logged and allowed" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES_FAIL=1
  grep -q "files_cmd for 12 failed" "$GATE_LOG" && echo "ok   the files_cmd failure was logged" || { echo "FAIL the files_cmd failure was logged"; fails=$((fails + 1)); }
  # commit identity: commit_email, at commit (best-effort) and at push (over the pushed commits)
  local I="$tmp/idrepo"
  git init -q "$I" && git -C "$I" remote add origin https://github.com/o/r.git && mkdir -p "$I/.claude" "$tmp/home2" || return 1
  printf '{"commit_email":"good@example.invalid"}\n' > "$I/.claude/gates.json"
  printf '[user]\n\temail = wrong@example.invalid\n\tname = w\n' > "$tmp/home2/.gitconfig"
  denies "identity: a wrong global email, no local config"  "not the project's commit_email" "$I" "git commit -m x" HOME="$tmp/home2"
  denies "identity: -c user.email=<wrong>"                  "would be wrong@x.invalid" "$I" "git -c user.email=wrong@x.invalid commit -m x" HOME="$tmp/home2"
  denies "identity: a quoted -c user.email='<wrong>'"       "would be wrong@x.invalid" "$I" "git -c user.email='wrong@x.invalid' commit -m x" HOME="$tmp/home2"
  denies "identity: GIT_AUTHOR_EMAIL=<wrong>"               "would be wrong@x.invalid" "$I" "GIT_AUTHOR_EMAIL=wrong@x.invalid git commit -m x" HOME="$tmp/home2"
  denies "identity: --author with the wrong email"          "would be wrong@x.invalid" "$I" "git commit --author=\"W <wrong@x.invalid>\" -m x" HOME="$tmp/home2"
  allows "identity: -c user.email=<right>"                  "$I" "git -c user.email=good@example.invalid commit -m x" HOME="$tmp/home2"
  git -C "$I" config user.email good@example.invalid
  allows "identity: the repository's own config matches"    "$I" "git commit -m x" HOME="$tmp/home2"
  ( cd "$I" && git -c user.email=wrong@x.invalid -c user.name=w commit -q --allow-empty -m bad ) || return 1
  denies "identity: a push carrying a wrong author"         "not authored by the project's commit_email" "$I" "git push -u origin HEAD"
  denies "identity: a push naming the branch"               "wrong@x.invalid" "$I" "git push origin $(git -C "$I" symbolic-ref --short HEAD)"
  git -C "$I" update-ref refs/remotes/origin/x HEAD
  ( cd "$I" && git -c user.name=g commit -q --allow-empty -m good ) || return 1
  allows "identity: a push whose new commits all match"     "$I" "git push -u origin HEAD"
  rm "$I/.claude/gates.json"
  ( cd "$I" && git -c user.email=wrong@x.invalid -c user.name=w commit -q --allow-empty -m bad2 ) || return 1
  allows "identity: no commit_email, no author check"       "$I" "git push origin HEAD"
  # a configured non-GitHub forge
  G="$tmp/glrepo"
  allows "other forge: sha pinned, checks green"   "$G" "forgecli merge 7 --sha $SHA"
  denies "other forge: no sha"                     "--sha" "$G" "forgecli merge 7"
  denies "other forge: a red check"                "ci: fail" "$G" "forgecli merge 7 --sha $SHA" GH_CHECKS='[{"name":"ci","bucket":"fail"}]'
  allows "other forge: gh is not its merge command" "$G" "gh pr merge 7"
  # gitlab.com: the built-in glab preset
  L="$tmp/glcom"
  local JOBS='[{"name":"test","status":"success","allow_failure":false},{"name":"lint","status":"failed","allow_failure":true},{"name":"deploy","status":"manual","allow_failure":true}]'
  allows "gitlab: sha pinned, pipeline green"       "$L" "glab mr merge 12 --squash --sha $SHA" GL_SHA=$SHA GL_JOBS="$JOBS"
  denies "gitlab: no --sha"                         "--sha" "$L" "glab mr merge 12 --squash" GL_SHA=$SHA
  denies "gitlab: head moved"                       "not $SHA" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$OTHER
  denies "gitlab: pipeline running"                 "pipeline: pending" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=running
  denies "gitlab: pipeline waiting on a manual job" "pipeline: pending" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=manual
  denies "gitlab: a failed job"                     "test: fail" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=failed GL_JOBS='[{"name":"test","status":"failed","allow_failure":false}]'
  denies "gitlab: a pipeline for an older head"     "pipeline: pending" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE_SHA=$OTHER
  denies "gitlab: no pipeline yet"                  "no checks" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=none
  allows "gitlab: -R names the project"             "$L" "glab mr merge 12 -R grp/proj --sha $SHA" GL_SHA=$SHA GL_EXPECT=grp%2Fproj
  denies "gitlab: -R reaches the named project"     "not $SHA" "$L" "glab mr merge 12 -R oth/er --sha $SHA" GL_SHA=$SHA GL_EXPECT=grp%2Fproj
  allows "gitlab: a URL names the merge request"    "$L" "glab mr merge https://gitlab.com/o/r/-/merge_requests/12 --sha=$SHA" GL_SHA=$SHA
  allows "gitlab: --squash-message's value is not the iid" "$L" "glab mr merge --squash-message 99 12 --sha $SHA" GL_SHA=$SHA
  denies "gitlab: a protected path in the diffs"    "protected path" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_FILES='[{"old_path":".claude/fleet.json","new_path":".claude/fleet.json"}]'
  printf '{"forge":"gitlab"}\n' > "$G/.claude/gates.json"
  allows "self-hosted: \"forge\": \"gitlab\" alone uses the preset" "$G" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA
  denies "self-hosted: the preset's checks gate it" "pipeline: pending" "$G" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=running
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
  ( cd "$L" && git checkout -q -b prot main && mkdir -p .claude && echo '{}' > .claude/gates.json && git add . && git commit -qm p && git checkout -q main ) || return 1
  mkdir -p "$L/.git/verified"; printf 'x\nt\n' > "$L/.git/verified/$(git -C "$L" rev-parse prot)"
  denies "no remote: a stamped merge touching a protected path" "protected path" "$L" "git merge prot"
  printf '%s\n' '{"verify_cmd":"make check"}' > "$L/.git/../.gates-tmp"; mkdir -p "$L/.claude"; mv "$L/.gates-tmp" "$L/.claude/gates.json"
  denies "no remote: a stamp from another command" "make check" "$L" "git merge feat"
  rm -rf "$L/.claude"
  allows "no remote: git merge --abort"            "$L" "git merge --abort"
  git -C "$L" checkout -q feat
  allows "no remote: merging main into a feature branch" "$L" "git merge main"
  git -C "$L" checkout -q main
  # fleet
  denies "fleet: merge outside the turn"        "fleet turn enter" "$F" "gh pr merge 12 --match-head-commit $FSHA" GH_HEAD=$FSHA
  allows "fleet: merge inside the turn"         "$F" "gh pr merge 12 --match-head-commit $FSHA" GH_HEAD=$FSHA HOLDS=1
  denies "fleet: a pinned sha that is not the slot's HEAD" "this slot's HEAD is $FSHA" "$F" "gh pr merge 12 --match-head-commit $SHA" HOLDS=1
  denies "fleet: fleet collisions refusing"     "both sides bumped X" "$F" "gh pr merge 12 --match-head-commit $FSHA" GH_HEAD=$FSHA HOLDS=1 COLL="both sides bumped X"
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
