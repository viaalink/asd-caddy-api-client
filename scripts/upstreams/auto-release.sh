#!/usr/bin/env bash
# Merge the upstream bot PR (bot/upstreams) once every CI check is green, then
# tag the version it carries; the tag starts release.yml, which publishes to
# npm. Run by .github/workflows/upstreams-release.yml from main's checkout:
# it reads the PR through the API and never runs the PR's code. It decides
# from the current state only, so running it again (hourly sweep, re-runs)
# is safe.
#
# 1. Recover: the newest merged bot PR (labelled auto-release, not hold) whose
#    version bump has no tag yet gets its tag (a run that died between merge
#    and tag).
# 2. Merge the open bot PR only when ALL of these hold, else exit 0 and say why:
#    - an open PR from bot/upstreams in this repo into main, labelled
#      auto-release, not labelled hold or gate-failing
#    - its head is HEAD_SHA (when given): no newer push is still being tested
#    - it is not behind main (else: update the branch, CI runs again), so the
#      tree CI tested is the tree that lands on main
#    - every required CI check (GitHub Actions) on that head concluded success
#    - it only touches what the bot and the auto-fix routine may change
#      (ALLOW), adds no .skip/.only and removes no test, and package.json
#      changes only its version
#    - that version is plain semver, above main's, with a CHANGELOG heading
# 3. Tag v<version> at the merge commit.
#
# Env: GH_TOKEN (UPSTREAMS_TOKEN: merging and tagging with it starts the
# workflows), GITHUB_REPOSITORY, HEAD_SHA (optional), DRY_RUN=1 to report only.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
BRANCH="${BOT_BRANCH:-bot/upstreams}" # override only to dry-run against another PR
REQUIRED=("Lint" "Type Check" "Unit Tests" "Integration Tests" "Caddy Security Tests"
  "Differential Fuzz Tests" "VSCode Extension Tests" "Build")
# What the bot writes (upstreams.yml add-paths) plus what a fix may need:
# library source and tests, docs, tygo configs. Not: workflows, scripts,
# configs, lockfiles, the extension.
ALLOW='^(upstreams\.json|package\.json|CHANGELOG\.md|DEPENDENCIES\.md|README\.md|vscode-extension/README\.md|\.github/actions/install-caddy/action\.yml|src/.+|docs/.+|scripts/upstreams/tygo/[^/]+\.yaml)$'
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

say() { echo "$*" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
warn() { echo "::warning::$*"; echo "⚠️ $*" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"; }
dry() { [ "${DRY_RUN:-}" = "1" ]; }
# REST, not `gh pr edit`: older gh versions fail that on the retired Projects (classic) API.
add_label() {
  if dry; then say "DRY RUN: would label PR #$1 $2"; return; fi
  gh api "repos/$REPO/issues/$1/labels" -f "labels[]=$2" >/dev/null || true
}
hold() { warn "PR #$1: $2 Labelled hold; a human decides."; add_label "$1" hold; exit 0; }
file_at() { gh api "repos/$REPO/contents/$1?ref=$2" --jq .content | base64 -d; }
version_at() { file_at package.json "$1" | jq -r .version; }
# 0 when $1 > $2 (both plain semver).
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

# Tag the release a merged bot PR carries, if it bumped the version.
tag_merge() {
  local merge=$1 pr=$2 version parent prev existing
  version=$(version_at "$merge")
  parent=$(gh api "repos/$REPO/commits/$merge" --jq '.parents[0].sha')
  prev=$(version_at "$parent")
  if [ "$version" = "$prev" ]; then return 0; fi
  if ! [[ "$version" =~ $SEMVER ]] || ! newer "$version" "$prev"; then
    warn "PR #$pr merged version '$version' after '$prev': not a plain semver step up; not tagging."
    return 0
  fi
  existing=$(gh api "repos/$REPO/git/ref/tags/v$version" --jq .object.sha 2>/dev/null || true)
  if [ -n "$existing" ]; then
    if [ "$existing" != "$merge" ]; then warn "Tag v$version exists at $existing, not at merge $merge."; fi
    return 0
  fi
  if dry; then say "DRY RUN: would tag v$version at $merge (PR #$pr)."; return 0; fi
  gh api "repos/$REPO/git/refs" -f ref="refs/tags/v$version" -f sha="$merge" >/dev/null
  say "Tagged v$version at $merge (PR #$pr): release.yml publishes it to npm."
}

bot_prs() { # $1 = state; only this repo's bot branch into main
  gh pr list --repo "$REPO" --head "$BRANCH" --state "$1" --limit 10 \
    --json number,headRefOid,labels,isCrossRepository,title,baseRefName,mergeCommit,mergedAt \
    --jq 'map(select(.isCrossRepository == false and .baseRefName == "main"))'
}

# --- 1. Recover a merged-but-untagged release --------------------------------
last=$(bot_prs merged | jq 'sort_by(.mergedAt) | last // empty')
if [ -n "$last" ] && jq -e '[.labels[].name] | index("auto-release") and (index("hold") | not)' <<<"$last" >/dev/null; then
  merge=$(jq -r '.mergeCommit.oid // empty' <<<"$last")
  if [ -n "$merge" ]; then tag_merge "$merge" "$(jq -r .number <<<"$last")"; fi
fi

# --- 2. The open bot PR -------------------------------------------------------
pr_json=$(bot_prs open | jq '.[0] // empty')
if [ -z "$pr_json" ]; then say "No open $BRANCH PR."; exit 0; fi

pr=$(jq -r .number <<<"$pr_json")
head=$(jq -r .headRefOid <<<"$pr_json")
title=$(jq -r '.title | sub("^\\[gate failing\\] "; "")' <<<"$pr_json")
labels=",$(jq -r '[.labels[].name] | join(",")' <<<"$pr_json"),"

if [[ "$labels" != *",auto-release,"* ]]; then say "PR #$pr has no auto-release label."; exit 0; fi
for l in hold gate-failing; do
  if [[ "$labels" == *",$l,"* ]]; then warn "PR #$pr is labelled auto-release and $l; not merging."; exit 0; fi
done
if [ -n "${HEAD_SHA:-}" ] && [ "$HEAD_SHA" != "$head" ]; then
  say "PR #$pr head is $head, this event was for $HEAD_SHA; the newer run decides."; exit 0
fi

# CI tests the PR merged into main as main was then. Only a PR that contains
# main merges as exactly what CI tested.
behind=$(gh api "repos/$REPO/compare/main...$head" --jq .behind_by)
if [ "$behind" != "0" ]; then
  if dry; then say "DRY RUN: PR #$pr is $behind commit(s) behind main; would update its branch."; exit 0; fi
  gh api -X PUT "repos/$REPO/pulls/$pr/update-branch" -f expected_head_sha="$head" >/dev/null
  say "PR #$pr was $behind commit(s) behind main: merged main into it; CI runs again."
  exit 0
fi

# Checks on the head commit from GitHub Actions: the newest run of each name.
checks=$(gh api --paginate "repos/$REPO/commits/$head/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.app.slug == "github-actions") | {id, name, status, conclusion}' |
  jq -s 'group_by(.name) | map(max_by(.id))')
for name in "${REQUIRED[@]}"; do
  c=$(jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.status)/\(.conclusion)"' <<<"$checks")
  if [ "$c" != "completed/success" ]; then
    say "PR #$pr: check '$name' is ${c:-missing}; not merging yet."; exit 0
  fi
done
bad=$(jq -r '.[] | select(.status == "completed" and (.conclusion | IN("success","skipped","neutral") | not)) | .name' <<<"$checks")
if [ -n "$bad" ]; then say "PR #$pr: failed checks: $(tr '\n' ' ' <<<"$bad")"; exit 0; fi

# What the PR may touch.
files=$(gh pr diff "$pr" --repo "$REPO" --name-only)
outside=$(grep -Ev "$ALLOW" <<<"$files" || true)
if [ -n "$outside" ]; then hold "$pr" "touches files outside what the bot may release on its own: $(tr '\n' ' ' <<<"$outside")."; fi
tests=$(gh api "repos/$REPO/compare/main...$head" \
  --jq '.files[] | select(.filename | test("^src/__tests__/|\\.test\\.ts$")) | .patch // ""')
if grep -Eq '^\+.*(\.(skip|only|todo)\b|\b(skipIf|runIf)\()' <<<"$tests"; then
  hold "$pr" "adds .skip/.only/.todo/skipIf/runIf to a test."
fi
removed=$(grep -Ec '^-[[:space:]]*(test|it|describe)(\.each\(.*\))?\(' <<<"$tests" || true)
added=$(grep -Ec '^\+[[:space:]]*(test|it|describe)(\.each\(.*\))?\(' <<<"$tests" || true)
if [ "$removed" -gt "$added" ]; then hold "$pr" "removes more test declarations ($removed) than it adds ($added)."; fi

base_pkg=$(file_at package.json main)
head_pkg=$(file_at package.json "$head")
if [ "$(jq -S 'del(.version)' <<<"$base_pkg")" != "$(jq -S 'del(.version)' <<<"$head_pkg")" ]; then
  hold "$pr" "changes package.json beyond its version."
fi
version=$(jq -r .version <<<"$head_pkg")
base_version=$(jq -r .version <<<"$base_pkg")
if [ "$version" != "$base_version" ]; then
  if ! [[ "$version" =~ $SEMVER ]] || ! newer "$version" "$base_version"; then
    hold "$pr" "version '$version' is not a plain semver step up from '$base_version'."
  fi
  if ! file_at CHANGELOG.md "$head" | grep -qF "## [$version]("; then
    hold "$pr" "CHANGELOG.md has no '## [$version](' heading."
  fi
fi

if dry; then
  say "DRY RUN: would merge PR #$pr ($title) at $head; version $base_version → $version."
  exit 0
fi

# --- 3. Merge and tag ---------------------------------------------------------
gh pr merge "$pr" --repo "$REPO" --squash --delete-branch --match-head-commit "$head" \
  --subject "$title (#$pr)"
merge=""
for _ in 1 2 3 4 5 6; do
  merge=$(gh pr view "$pr" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid // empty')
  [ -n "$merge" ] && break
  sleep 5
done
if [ -z "$merge" ]; then
  warn "Merged PR #$pr but its merge commit is not visible yet; the next sweep tags it."
  exit 0
fi
say "Merged PR #$pr as $merge."
if [ "$version" = "$base_version" ]; then
  say "Version unchanged ($version): generated code did not change, nothing to publish."
  exit 0
fi
tag_merge "$merge" "$pr"
