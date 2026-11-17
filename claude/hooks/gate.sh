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
# Project config: .claude/gates.json on the default branch (fields documented at load_config below).
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
WORDS=(); ENV_HOME=""; ENV_AUTHOR=""; SHELL_AUTHOR=""
parse_segment() {
  local seg=$1 w
  set -f; WORDS=($seg); set +f
  ENV_HOME=""; ENV_AUTHOR=""
  # Redirections are the shell's, not the command's: drop them (and a bare operator's target).
  local kept=() skip=""
  for w in ${WORDS[@]+"${WORDS[@]}"}; do
    if [ -n "$skip" ]; then skip=""; continue; fi
    case "$w" in
      '>'|'>>'|'<'|'<<'|'<<<'|'>|'|'&>'|'&>>'|[0-9]'>'|[0-9]'>>'|[0-9]'<') skip=1 ;;
      '>'*|'<'*|'&>'*|[0-9]'>'*|[0-9]'<'*) ;;
      *) kept+=("$w") ;;
    esac
  done
  WORDS=(${kept[@]+"${kept[@]}"})
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

# For a git segment: GIT_SUB = subcommand, GIT_REST = its arguments, GIT_EMAIL = -c user.email,
# GIT_GLOBAL = the options that pick the repository (-C, --git-dir, --work-tree), replayed on every
# git the checks run so they read the repository the command targets.
# GIT_TARGET_UNKNOWN=1 when one of those names a path this hook cannot read (a quoted value it
# cannot recover unambiguously, or an expansion).
GIT_SUB=""; GIT_REST=(); GIT_EMAIL=""; GIT_GLOBAL=(); GIT_TARGET_UNKNOWN=""
# The value of a quoted repository option, from RAW_CMD; empty unless exactly one value is found.
unq_opt() { # option
  local vals
  vals=$(printf '%s' "$RAW_CMD" | tr '\n' ' ' | grep -o -E -- "(^|[[:space:]])$1[[:space:]]+(\"[^\"]*\"|'[^']*')" \
    | sed -E "s/^[[:space:]]*$1[[:space:]]+[\"']//; s/[\"']\$//" | sort -u)
  [ -n "$vals" ] && [ "$(printf '%s\n' "$vals" | wc -l | tr -d ' ')" = 1 ] && printf '%s' "$vals"
}
parse_git() {
  local i=1 n=${#WORDS[@]} w v
  GIT_SUB=""; GIT_REST=(); GIT_EMAIL=""; GIT_GLOBAL=(); GIT_TARGET_UNKNOWN=""
  while [ $i -lt $n ]; do
    w=${WORDS[$i]}
    case "$w" in
      -C|-c|--git-dir|--work-tree|--namespace)
        v=${WORDS[$((i + 1))]:-}
        if [ "$w" = "-c" ]; then
          case "$v" in
            user.email=*) GIT_EMAIL=$(unq 'user\.email' "${v#user.email=}") ;;
            # -c "user.email=x": the whole pair was quoted
            Q) v=$(printf '%s' "$RAW_CMD" | tr '\n' ' ' | sed -n -E "s/.*-c[[:space:]]+[\"']user\.email=([^\"']*)[\"'].*/\\1/p" | head -1)
               [ -z "$v" ] || GIT_EMAIL=$v ;;
          esac
        elif [ "$w" != "--namespace" ]; then
          [ "$v" != Q ] || v=$(unq_opt "$w")
          case "$v" in ""|*'$'*|*'`'*) GIT_TARGET_UNKNOWN=1 ;; *) GIT_GLOBAL+=("$w" "$v") ;; esac
        fi
        i=$((i + 2)) ;;
      --git-dir=*|--work-tree=*)
        case "$w" in *=Q|*'$'*|*'`'*) GIT_TARGET_UNKNOWN=1 ;; *) GIT_GLOBAL+=("$w") ;; esac
        i=$((i + 1)) ;;
      -*) i=$((i + 1)) ;;
      *) GIT_SUB=$w; GIT_REST=("${WORDS[@]:$((i + 1))}"); return 0 ;;
    esac
  done
}

# git in the repository the parsed command targets.
tgit() { # cwd args...
  local d=$1; shift
  (cd "$d" 2>/dev/null && git ${GIT_GLOBAL[@]+"${GIT_GLOBAL[@]}"} "$@")
}
# The target repository's commit_email: its own default-branch config, not the session's.
target_want() { # cwd
  local top
  top=$(tgit "$1" rev-parse --show-toplevel 2>/dev/null) || top=$1
  CFG=$(config_file "$top") cfg commit_email
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
      local want; want=$(target_want "$cwd")
      [ -z "$want" ] || [ -z "$GIT_TARGET_UNKNOWN" ] \
        || deny "git push is refused: this repository sets commit_email, and the repository this push names (git -C/--git-dir) cannot be read from the command. Name the path literally, or cd there first."
      [ -z "$want" ] || check_push_authors "$cwd" "$want" ;;
    rebase)
      case "${GIT_REST[0]:-}" in --abort|--quit) return 0 ;; esac
      deny "git rebase is refused: ask the user first. To bring a branch up to date, merge main into it." ;;
    commit)
      # git's precedence: --author, then GIT_AUTHOR_EMAIL, then user.email (-c, then config).
      local email="" want
      # A repository this hook cannot read is left to the push check, which judges the commit.
      [ -z "$GIT_TARGET_UNKNOWN" ] || { log "git commit names a repository this hook cannot read; left to the push check"; return 0; }
      for a in ${GIT_REST[@]+"${GIT_REST[@]}"}; do
        case "$a" in --author=*|--author) email=$(printf '%s' "$RAW_CMD" | tr '\n' ' ' | sed -n -E 's/.*--author[= ]+[^<;&|]*<([^>]*)>.*/\1/p' | head -1) ;; esac
      done
      [ -n "$email" ] || email=$ENV_AUTHOR
      [ -n "$email" ] || email=$SHELL_AUTHOR
      [ -n "$email" ] || email=$GIT_EMAIL
      if [ -z "$email" ]; then
        if [ -n "$ENV_HOME" ]; then
          email=$(HOME=$ENV_HOME tgit "$cwd" config user.email 2>/dev/null)
        else
          email=$(tgit "$cwd" config user.email 2>/dev/null)
        fi
      fi
      # A shell expansion is not known here; the push check judges the commit it made.
      case "$email" in *'$'*|*'`'*) log "commit author email is an expansion ($email); left to the push check"; return 0 ;; esac
      [ -n "$email" ] || deny "git commit is refused: no user.email is set${ENV_HOME:+ under HOME=$ENV_HOME} — the commit would carry an unlinked author. Set HOME per command only for the tool that needs it, or pass -c user.email=<address>."
      want=$(target_want "$cwd")
      [ -z "$want" ] || [ "$email" = "$want" ] \
        || deny "git commit is refused: its author email would be $email, not the project's commit_email $want (.claude/gates.json). Set it in the repository's own config (git config user.email $want), or drop the override." ;;
  esac
  return 0
}

# git push: every commit it would publish (reachable from what it pushes, on no remote-tracking ref
# yet) must be authored by the project's commit_email.
check_push_authors() { # cwd want
  local cwd=$1 want=$2 i=0 n=${#GIT_REST[@]} a remote="" srcs=() src bad specs=0 out
  while [ $i -lt $n ]; do
    a=${GIT_REST[$i]}
    case "$a" in
      --repo|-o|--push-option|--receive-pack|--exec) i=$((i + 2)); continue ;;
      -d|--delete) return 0 ;;   # a delete publishes no commit
      --all|--branches|--mirror) srcs+=(--branches); specs=1 ;;
      --tags) srcs+=(--tags); specs=1 ;;
      -*) ;;
      *) if [ -z "$remote" ]; then remote=$a
         elif [ "$a" = tag ] && [ $((i + 1)) -lt $n ]; then specs=1; i=$((i + 1)); srcs+=("refs/tags/${GIT_REST[$i]}")
         else specs=1; src=${a#+}; src=${src%%:*}; [ -n "$src" ] && srcs+=("$src"); fi ;;
    esac
    i=$((i + 1))
  done
  # No refspec at all pushes the current branch; refspecs that are all deletes (:dst) publish nothing.
  if [ ${#srcs[@]} -eq 0 ]; then [ "$specs" = 1 ] && return 0; srcs=(HEAD); fi
  # The push check is the authoritative one: a source it cannot read is a refusal, not a pass.
  local errf; errf=$(mktemp "${TMPDIR:-/tmp}/gate-err.XXXXXX") || oops "mktemp failed"
  if ! out=$(tgit "$cwd" log --format='%h %ae' "${srcs[@]}" --not --remotes -- 2>"$errf"); then
    a=$(head -1 "$errf"); rm -f "$errf"
    deny "git push is refused: cannot list the commits it would publish (git log ${srcs[*]} --not --remotes failed: $a). Name the refspec unquoted, or ask the user."
  fi
  rm -f "$errf"
  bad=$(printf '%s\n' "$out" | awk -v w="$want" 'NF && $2 != w' | head -5)
  [ -z "$bad" ] || deny "git push is refused: it would publish commits not authored by the project's commit_email $want (.claude/gates.json): $(printf '%s' "$bad" | tr '\n' ';' | sed 's/;$//; s/;/; /g'). Set git config user.email $want, then re-author them (git commit --amend --reset-author for the last one; ask the user before rewriting more)."
  return 0
}

# --- the project's forge and verification config --------------------------------------------------
# .claude/gates.json, read from the default branch's committed copy (origin/<branch>, else the
# local branch), never from the work tree: a change, or an uncommitted edit, cannot rewrite the rules
# that judge it. An edit is in force once it is on the default branch. All fields optional:
#   forge          github | gitlab | other | none   (default: github when origin is on github.com,
#                  none when there is no remote, else unknown → the forge gate is skipped, logged)
#   default_branch the branch merges land on (default: origin/HEAD, else main or master)
#   ci             true | false   (default: true for github; for other forges, true iff checks_cmd is set)
#   merge_cmd      ERE matching the forge's merge command (github default: ^gh pr merge)
#   sha_flag       the merge command's flag binding the merged head (github default: --match-head-commit)
#   head_cmd       shell, prints the change's head sha; $PR is the change number
#   checks_cmd     shell, prints JSON [{"name","bucket"}] with bucket pass|fail|pending|skipping|cancel
#   files_cmd      shell, prints the change's changed paths, one per line (github and gitlab built
#                  in); exit 3 = too many to list, which denies
#   required_checks names that must be listed and pass, on top of the rule that every listed check
#                  passes or is skipping: a forge lists only the checks that have registered, so a
#                  required check that has not started yet would otherwise go unnoticed
#   protected_paths globs (bash case patterns) a session never merges, on top of
#                  .claude/gates.json and .claude/fleet.json
#   commit_email   the author email every commit and push must carry
#   verify_cmd     the complete local suite command; a verified stamp must have been made by it
CFG=""   # the config's JSON text, not a path
# The branch whose config is read: origin/HEAD, else main or master. Deliberately not the config's
# own default_branch, which a work tree could otherwise point at a branch it controls.
config_branch() { # cwd
  local b
  b=$(cd "$1" 2>/dev/null && git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null) && { echo "${b#origin/}"; return; }
  for b in main master; do
    (cd "$1" && { git show-ref -q --verify "refs/remotes/origin/$b" || git show-ref -q --verify "refs/heads/$b"; }) 2>/dev/null && { echo "$b"; return; }
  done
  (cd "$1" 2>/dev/null && git rev-parse -q --verify HEAD >/dev/null 2>&1) \
    && log "no default branch found (no origin/HEAD, main or master) in $1: .claude/gates.json not read, defaults apply. Set it with git remote set-head origin --auto."
}
# Prints the default branch's .claude/gates.json (a JSON object), or nothing.
config_file() { # cwd
  local b ref j
  b=$(config_branch "$1"); [ -n "$b" ] || return 0
  for ref in "refs/remotes/origin/$b" "refs/heads/$b"; do
    (cd "$1" 2>/dev/null && git rev-parse -q --verify "$ref" >/dev/null 2>&1) || continue
    j=$(cd "$1" 2>/dev/null && git show "$ref:.claude/gates.json" 2>/dev/null) || return 0
    if printf '%s' "$j" | jq -e 'type == "object"' >/dev/null 2>&1; then printf '%s\n' "$j"
    else log "unparsable .claude/gates.json on $ref; using defaults"; fi
    return 0
  done
}
load_config() { CFG=$(config_file "$1"); }
# has(), not //: jq's // treats false as absent, so a configured "ci": false would fall back to the default.
cfg() { [ -n "$CFG" ] && printf '%s' "$CFG" | jq -r --arg k "$1" 'if has($k) and .[$k] != null then .[$k] | if type == "array" then .[] else tostring end else empty end' 2>/dev/null; }
# required_checks as a JSON array of strings ([] when unset).
required_json() {
  local j=""
  [ -n "$CFG" ] && j=$(printf '%s' "$CFG" | jq -c '.required_checks // [] | if type == "array" then map(tostring) else [tostring] end' 2>/dev/null)
  printf '%s\n' "${j:-[]}"
}
log() { { printf '%s gate.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; } 2>/dev/null; }

# The protected globs, the two built-in ones first (the config itself comes from the default branch).
protected_globs() {
  printf '%s\n' .claude/gates.json .claude/fleet.json
  cfg protected_paths
}
# Deny when one of the changed paths (stdin, one per line) matches a protected glob.
deny_protected() { # cwd what
  local globs f g hit=""
  globs=$(protected_globs)
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
# changes_count reads "N+" once the merge request is past the instance's diff limit: exit 3.
GL_FILES_CMD='n=$(glab api "projects/${GL_PROJECT:-:fullpath}/merge_requests/$PR" | jq -r .changes_count) || exit 1; case "$n" in *+*) exit 3 ;; esac; glab api --paginate "projects/${GL_PROJECT:-:fullpath}/merge_requests/$PR/diffs?per_page=100" | jq -r ".[] | .old_path, .new_path"'
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
    # The files API lists at most 3000 files: past that, exit 3 (too many to check).
    github:files_cmd)  echo 'n=$(gh pr view "$PR" $REPO_FLAG --json changedFiles -q .changedFiles) || exit 1; [ "$n" -lt 3000 ] || exit 3; gh api --paginate "repos/${REPO:-"{owner}/{repo}"}/pulls/$PR/files" --jq ".[] | .filename, (.previous_filename // empty)"' ;;
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
  else
    local fst=0
    files=$(cd "$cwd" 2>/dev/null && PR=$pr REPO_FLAG=${repo:+"-R $repo"} GL_PROJECT=$(printf '%s' "$repo" | sed 's,/,%2F,g') REPO=$repo sh -c "$files_cmd" 2>/dev/null) || fst=$?
    case "$fst" in
      0) deny_protected "$cwd" "the merge of change $pr" <<EOF
$files
EOF
         ;;
      3) deny "the merge of change $pr is refused: it changes more files than the forge lists, so its protected paths cannot be checked. The user merges this one." ;;
      *) log "files_cmd for $pr failed; protected paths not checked" ;;
    esac
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
  config_branch "$1"
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
  deny_protected "$cwd" "git merge of $target into $def" <<EOF
$(cd "$cwd" 2>/dev/null && git diff --no-renames --name-only "$def...$sha" 2>/dev/null)
EOF
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
    # export GIT_AUTHOR_EMAIL=x; git commit — the variable reaches later segments' commits.
    if [ "${WORDS[0]}" = export ]; then
      local w; for w in "${WORDS[@]:1}"; do
        case "$w" in GIT_AUTHOR_EMAIL=*) SHELL_AUTHOR=$(unq GIT_AUTHOR_EMAIL "${w#GIT_AUTHOR_EMAIL=}") ;; esac
      done
      continue
    fi
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
  (cd "$tmp" && for r in repo fleetrepo noemail local glrepo glcom; do git init -q -b main "$r" || exit 1; done) || return 1
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
  # The config is read from the default branch's commit: setgates commits it on main (and moves
  # origin/main with it when that ref exists); an empty json removes it. SG_EMAIL is its author.
  setgates() { # dir json
    ( cd "$1" && [ "$(git symbolic-ref -q --short HEAD)" = main ] || { echo "setgates: $1 is not on main"; exit 1; }
      mkdir -p .claude
      if [ -n "$2" ]; then printf '%s\n' "$2" > .claude/gates.json && git add .claude/gates.json
      else git rm -q --ignore-unmatch .claude/gates.json && rm -f .claude/gates.json; fi
      git -c user.email="${SG_EMAIL:-t@example.invalid}" -c user.name=t commit -q --allow-empty -m gates || exit 1
      ! git rev-parse -q --verify refs/remotes/origin/main >/dev/null || git update-ref refs/remotes/origin/main HEAD
    ) || { echo "FAIL setgates $1"; fails=$((fails + 1)); }
  }
  setgates "$tmp/glrepo" '{"forge":"gitlab","merge_cmd":"^forgecli merge","sha_flag":"--sha","head_cmd":"forgecli head $PR","checks_cmd":"forgecli checks $PR","ci":true}'
  cat > "$tmp/bin/gh" <<'EOF'
#!/bin/sh
[ "${GH_FAIL:-0}" = 1 ] && exit 1
case "$1 $2" in
  "pr view")   case "$*" in *changedFiles*) echo "${GH_NFILES:-1}" ;; *) echo "$GH_HEAD" ;; esac ;;
  "pr checks") printf '%s\n' "$GH_CHECKS"; echo "$GH_CHECKS" | grep -q '"pass"' || exit 8 ;;
  "api --paginate")
     # pulls/N/files: GH_FILES_JSON, else GH_FILES (comma-separated) as plain filenames; --jq applied
     [ "${GH_FILES_FAIL:-0}" = 1 ] && exit 1
     q=""; prev=""; for a in "$@"; do [ "$prev" = --jq ] && q=$a; prev=$a; done
     j=${GH_FILES_JSON:-$(printf '%s' "${GH_FILES:-}" | jq -R 'split(",") | map(select(length > 0) | {filename: .})')}
     printf '%s' "$j" | jq -r "${q:-.}" ;;
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
     else jq -n --arg s "$sha" --arg ps "${GL_PIPE_SHA:-$sha}" --arg st "${GL_PIPE:-success}" --arg cc "${GL_CHANGES:-1}" \
       '{sha: $s, changes_count: $cc, head_pipeline: {id: 5, sha: $ps, status: $st}}'; fi ;;
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
  # A deny is exactly one JSON document: two concatenated ones are not a valid hook answer.
  denies() { local name=$1 want=$2; shift 2; out=$(run "$@"); if [ "$(printf '%s' "$out" | jq -s length 2>/dev/null)" = 1 ] && printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 && printf '%s' "$out" | grep -q -- "$want"; then echo "ok   $name"; else echo "FAIL $name: ${out:-<allowed>}"; fails=$((fails + 1)); fi; }
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
  setgates "$R" '{"required_checks":["ci","cla"]}'
  denies "merge: a required check missing"      "cla: missing" "$R" "gh pr merge 12 --match-head-commit $SHA"
  printf '{}\n' > "$R/.claude/gates.json"
  denies "config: an uncommitted edit to gates.json is not in force" "cla: missing" "$R" "gh pr merge 12 --match-head-commit $SHA"
  setgates "$R" '{"required_checks":["ci"]}'
  denies "merge: an unrequired check failing still counts" "flaky: fail" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"flaky","bucket":"fail"}]'
  denies "merge: an unrequired check pending still counts" "lint: pending" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"lint","bucket":"pending"}]'
  allows "merge: required passes, the rest pass or skip" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"lint","bucket":"skipping"},{"name":"x","bucket":"pass"}]'
  denies "merge: a required check listed twice, one failing" "ci: fail" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"pass"},{"name":"ci","bucket":"fail"}]'
  denies "merge: a required check skipped" "ci: skipping" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"ci","bucket":"skipping"},{"name":"x","bucket":"pass"}]'
  denies "merge: a required check missing, the rest green" "ci: missing" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS='[{"name":"x","bucket":"pass"}]'
  setgates "$R" '{"forge":"github","ci":false}'
  denies "github with \"ci\": false: a merge wants a stamp, not checks" "verify-head" "$R" "gh pr merge 12 --match-head-commit $SHA"
  mkdir -p "$R/.git/verified"; printf 'x\nt\n' > "$R/.git/verified/$SHA"
  allows "github with \"ci\": false: a stamped head merges" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_CHECKS="$PENDING"
  rm -rf "$R/.git/verified"
  setgates "$R" ''
  allows "merge: a gh failure is logged and allowed" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FAIL=1
  grep -q "head_cmd for 12 failed" "$GATE_LOG" && echo "ok   the gh failure was logged" || { echo "FAIL the gh failure was logged"; fails=$((fails + 1)); }
  # protected paths: the two configs always, plus the default branch's own protected_paths
  denies "protected: a change to .claude/gates.json"  "protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES="src/a.rs,.claude/gates.json"
  denies "protected: a protected path with a check still pending denies once" "protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".claude/gates.json" GH_CHECKS="$PENDING"
  denies "protected: a change to .claude/fleet.json"  "protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".claude/fleet.json"
  allows "protected: an ordinary workflow change"     "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/ci.yml,src/a.rs"
  setgates "$R" '{"protected_paths":["LICENSE*",".github/workflows/cla.yml"]}'
  ( cd "$R" && git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main ) || return 1
  denies "protected: a glob from the default branch's protected_paths" "LICENSE-MIT, a protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES="LICENSE-MIT"
  allows "protected: the default branch's list is not a prefix match" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/cla.yml.bak"
  printf '{}\n' > "$R/.claude/gates.json"
  denies "protected: the work tree dropping protected_paths does not lift it" "cla.yml, a protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES=".github/workflows/cla.yml"
  denies "protected: more files than the forge lists"  "more files than the forge lists" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_NFILES=3000
  denies "protected: a rename's old path counts" ".claude/gates.json, a protected path" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES_JSON='[{"filename":"elsewhere.json","previous_filename":".claude/gates.json"}]'
  git -C "$R" checkout -q -- .claude/gates.json
  allows "protected: a files_cmd failure is logged and allowed" "$R" "gh pr merge 12 --match-head-commit $SHA" GH_FILES_FAIL=1
  grep -q "files_cmd for 12 failed" "$GATE_LOG" && echo "ok   the files_cmd failure was logged" || { echo "FAIL the files_cmd failure was logged"; fails=$((fails + 1)); }
  # commit identity: commit_email, at commit (best-effort) and at push (over the pushed commits)
  local I="$tmp/idrepo"
  git init -q -b main "$I" && git -C "$I" remote add origin https://github.com/o/r.git && mkdir -p "$tmp/home2" || return 1
  SG_EMAIL=good@example.invalid setgates "$I" '{"commit_email":"good@example.invalid"}'
  printf '[user]\n\temail = wrong@example.invalid\n\tname = w\n' > "$tmp/home2/.gitconfig"
  denies "identity: a wrong global email, no local config"  "not the project's commit_email" "$I" "git commit -m x" HOME="$tmp/home2"
  denies "identity: -c user.email=<wrong>"                  "would be wrong@x.invalid" "$I" "git -c user.email=wrong@x.invalid commit -m x" HOME="$tmp/home2"
  denies "identity: a quoted -c user.email='<wrong>'"       "would be wrong@x.invalid" "$I" "git -c user.email='wrong@x.invalid' commit -m x" HOME="$tmp/home2"
  denies "identity: GIT_AUTHOR_EMAIL=<wrong>"               "would be wrong@x.invalid" "$I" "GIT_AUTHOR_EMAIL=wrong@x.invalid git commit -m x" HOME="$tmp/home2"
  denies "identity: --author with the wrong email"          "would be wrong@x.invalid" "$I" "git commit --author=\"W <wrong@x.invalid>\" -m x" HOME="$tmp/home2"
  allows "identity: -c user.email=<right>"                  "$I" "git -c user.email=good@example.invalid commit -m x" HOME="$tmp/home2"
  denies "identity: --author beats -c user.email"           "would be bad@x.invalid" "$I" "git -c user.email=good@example.invalid commit --author=\"W <bad@x.invalid>\" -m x" HOME="$tmp/home2"
  denies "identity: GIT_AUTHOR_EMAIL beats -c user.email"   "would be bad@x.invalid" "$I" "GIT_AUTHOR_EMAIL=bad@x.invalid git -c user.email=good@example.invalid commit -m x" HOME="$tmp/home2"
  allows "identity: a right --author over a wrong user.email" "$I" "git -c user.email=bad@x.invalid commit --author=\"G <good@example.invalid>\" -m x" HOME="$tmp/home2"
  denies "identity: a wholly quoted -c \"user.email=<wrong>\"" "would be bad@x.invalid" "$I" "git -c \"user.email=bad@x.invalid\" commit -m x" HOME="$tmp/home2"
  denies "identity: export GIT_AUTHOR_EMAIL=<wrong>; git commit" "would be bad@x.invalid" "$I" "export GIT_AUTHOR_EMAIL=bad@x.invalid; git -c user.email=good@example.invalid commit -m x" HOME="$tmp/home2"
  allows "identity: an expansion is left to the push check" "$I" "GIT_AUTHOR_EMAIL=\$E git commit -m x" HOME="$tmp/home2"
  denies "identity: git -C targets the other repository's config" "not the project's commit_email good@example.invalid" "$R" "git -C $I -c user.email=bad@x.invalid commit -m x"
  git -C "$I" config user.email good@example.invalid
  allows "identity: the repository's own config matches"    "$I" "git commit -m x" HOME="$tmp/home2"
  allows "identity: a quoted git -C path is read"           "$tmp" "git -C \"$I\" commit -m x 2>&1"
  allows "identity: a git -C target named by an expansion is left to the push" "$I" "git -C \"\$D\" -c user.email=bad@x.invalid commit -m x"
  ( cd "$I" && git -c user.email=wrong@x.invalid -c user.name=w commit -q --allow-empty -m bad ) || return 1
  denies "identity: a push carrying a wrong author"         "not authored by the project's commit_email" "$I" "git push -u origin HEAD"
  denies "identity: a push naming the branch"               "wrong@x.invalid" "$I" "git push origin $(git -C "$I" symbolic-ref --short HEAD)"
  denies "identity: a quoted refspec cannot be read, so it is refused" "cannot list the commits" "$I" "git push origin \"main\""
  git -C "$I" tag v1
  denies "identity: git push origin tag <name> checks the tag" "wrong@x.invalid" "$I" "git push origin tag v1"
  denies "identity: git -C pushes the other repository's commits" "wrong@x.invalid" "$R" "git -C $I push origin HEAD"
  denies "identity: a quoted git -C path is read for the push" "wrong@x.invalid" "$tmp" "git -C \"$I\" push origin HEAD"
  denies "identity: an unreadable git -C target is refused where commit_email is set" "cannot be read from the command" "$I" "git -C \"\$D\" push origin HEAD"
  allows "identity: an unreadable git -C target passes where none is set" "$tmp" "git -C \"\$D\" push origin HEAD"
  allows "identity: a delete refspec publishes nothing"     "$I" "git push origin :old"
  allows "identity: --delete publishes nothing"             "$I" "git push --delete origin old"
  git -C "$I" update-ref refs/remotes/origin/x HEAD
  ( cd "$I" && git -c user.name=g commit -q --allow-empty -m good ) || return 1
  allows "identity: a push whose new commits all match"     "$I" "git push -u origin HEAD"
  allows "identity: redirections are not refspecs"          "$I" "git push -u origin HEAD 2>&1 > /dev/null"
  git -C "$I" branch amb && git -C "$I" tag amb
  allows "identity: an ambiguous refname's warning is not an author" "$I" "git push origin amb"
  SG_EMAIL=good@example.invalid setgates "$I" ''
  git -C "$I" update-ref refs/remotes/origin/x HEAD
  ( cd "$I" && git -c user.email=wrong@x.invalid -c user.name=w commit -q --allow-empty -m bad2 ) || return 1
  allows "identity: no commit_email, no author check"       "$I" "git push origin HEAD"
  # the config branch: origin/main with no origin/HEAD and no local main
  local FB="$tmp/fbrepo"
  ( git init -q -b work "$FB" && cd "$FB" && git remote add origin https://github.com/o/r.git && mkdir .claude \
    && printf '{"commit_email":"good@example.invalid"}\n' > .claude/gates.json && git add . \
    && git -c user.email=good@example.invalid -c user.name=g commit -qm c && git update-ref refs/remotes/origin/main HEAD ) || return 1
  denies "config: origin/main is read with no origin/HEAD or local main" "not the project's commit_email" "$FB" "git -c user.email=bad@x.invalid commit -m x"
  ( cd "$FB" && git update-ref -d refs/remotes/origin/main ) || return 1
  allows "config: no default branch at all: defaults apply" "$FB" "git -c user.email=bad@x.invalid commit -m x"
  grep -q "no default branch found" "$GATE_LOG" && echo "ok   no default branch is logged" || { echo "FAIL no default branch is logged"; fails=$((fails + 1)); }
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
  denies "gitlab: past the instance's diff limit"   "more files than the forge lists" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_CHANGES=1000+
  denies "gitlab: a protected path in the diffs"    "protected path" "$L" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_FILES='[{"old_path":".claude/fleet.json","new_path":".claude/fleet.json"}]'
  setgates "$G" '{"forge":"gitlab"}'
  allows "self-hosted: \"forge\": \"gitlab\" alone uses the preset" "$G" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA
  denies "self-hosted: the preset's checks gate it" "pipeline: pending" "$G" "glab mr merge 12 --sha $SHA" GL_SHA=$SHA GL_PIPE=running
  # a forge with no CI: the stamp is the evidence
  setgates "$G" '{"forge":"gitlab","merge_cmd":"^forgecli merge","sha_flag":"--sha","head_cmd":"forgecli head $PR","ci":false}'
  denies "no CI: a merge without a stamp"          "verify-head" "$G" "forgecli merge 7 --sha $SHA"
  mkdir -p "$G/.git/verified"; printf 'make test\n2026-01-01T00:00:00Z\n' > "$G/.git/verified/$SHA"
  allows "no CI: a stamped head merges"            "$G" "forgecli merge 7 --sha $SHA"
  # an unconfigured unknown forge: logged, not denied
  setgates "$G" ''
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
  ( cd "$L" && git checkout -q -b prot2 main && mkdir -p .claude && echo '{}' > .claude/fleet.json && git add . && git commit -qm p && git checkout -q main ) || return 1
  denies "no remote: an unstamped protected merge denies once" "protected path" "$L" "git merge prot2"
  setgates "$L" '{"verify_cmd":"make check"}'
  ( cd "$L" && git checkout -q -b ren main && git mv .claude/gates.json elsewhere.json && git commit -qm ren && git checkout -q main ) || return 1
  printf 'x\nt\n' > "$L/.git/verified/$(git -C "$L" rev-parse ren)"
  denies "no remote: renaming a protected path away counts" ".claude/gates.json, a protected path" "$L" "git merge ren"
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
