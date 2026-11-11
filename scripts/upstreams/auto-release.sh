#!/usr/bin/env bash
# Merge the upstream bot PR (bot/upstreams) once every CI check is green, then
# tag the version it carries; the tag starts release.yml, which publishes to
# npm. Run by .github/workflows/upstreams-release.yml from main's checkout:
# it reads the PR through the API and never runs the PR's code.
#
# Merges only when ALL of these hold, else exits 0 and says why:
#   - an open PR from bot/upstreams in this repo, labelled auto-release,
#     not labelled hold or gate-failing
#   - its head is HEAD_SHA (when given): no newer push is still being tested
#   - every required CI check on that head concluded success, none failed
#   - it touches no workflow, hook, Justfile or lockfile (what CI and
#     releases run, and the dependency set), and package.json changes only
#     its version
#
# Env: GH_TOKEN (UPSTREAMS_TOKEN: merging and tagging with it starts the
# release workflow), GITHUB_REPOSITORY, HEAD_SHA (optional), DRY_RUN=1 to
# report only.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
BRANCH="${BOT_BRANCH:-bot/upstreams}" # override only to dry-run against another PR
REQUIRED=("Lint" "Type Check" "Unit Tests" "Integration Tests" "Caddy Security Tests"
  "Differential Fuzz Tests" "VSCode Extension Tests" "Build")
DENY='^(\.github/workflows/|\.husky/|Justfile$|bun\.lock$|package-lock\.json$|vscode-extension/package(-lock)?\.json$)'

say() { echo "$*" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
# REST, not `gh pr edit`: older gh versions fail that on the retired Projects (classic) API.
add_label() {
  if [ "${DRY_RUN:-}" = "1" ]; then say "DRY RUN: would label PR #$1 $2"; return; fi
  gh api "repos/$REPO/issues/$1/labels" -f "labels[]=$2" >/dev/null || true
}

pr_json=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open \
  --json number,headRefOid,labels,isCrossRepository,title,baseRefName --jq '.[0] // empty')
if [ -z "$pr_json" ]; then say "No open $BRANCH PR."; exit 0; fi

pr=$(jq -r .number <<<"$pr_json")
head=$(jq -r .headRefOid <<<"$pr_json")
title=$(jq -r .title <<<"$pr_json")
labels=",$(jq -r '[.labels[].name] | join(",")' <<<"$pr_json"),"

if [ "$(jq -r .isCrossRepository <<<"$pr_json")" = "true" ] || [ "$(jq -r .baseRefName <<<"$pr_json")" != "main" ]; then
  say "PR #$pr is not bot/upstreams → main in this repo; leaving it."; exit 0
fi
if [[ "$labels" != *",auto-release,"* ]]; then say "PR #$pr has no auto-release label."; exit 0; fi
for l in hold gate-failing; do
  if [[ "$labels" == *",$l,"* ]]; then say "PR #$pr is labelled $l."; exit 0; fi
done
if [ -n "${HEAD_SHA:-}" ] && [ "$HEAD_SHA" != "$head" ]; then
  say "PR #$pr head is $head, this event was for $HEAD_SHA; the newer run decides."; exit 0
fi

# Checks on the head commit: the newest run of each name.
checks=$(gh api --paginate "repos/$REPO/commits/$head/check-runs?per_page=100" \
  --jq '.check_runs[] | {name, status, conclusion, started_at}' | jq -s 'group_by(.name) | map(max_by(.started_at))')
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
denied=$(grep -E "$DENY" <<<"$files" || true)
if [ -n "$denied" ]; then
  say "PR #$pr touches files the bot may not release on its own: $(tr '\n' ' ' <<<"$denied")"
  add_label "$pr" hold
  exit 0
fi
pkg_at() { gh api "repos/$REPO/contents/package.json?ref=$1" --jq .content | base64 -d; }
base_pkg=$(pkg_at main)
head_pkg=$(pkg_at "$head")
if [ "$(jq -S 'del(.version)' <<<"$base_pkg")" != "$(jq -S 'del(.version)' <<<"$head_pkg")" ]; then
  say "PR #$pr changes package.json beyond its version; holding it."
  add_label "$pr" hold
  exit 0
fi
version=$(jq -r .version <<<"$head_pkg")
base_version=$(jq -r .version <<<"$base_pkg")

if [ "${DRY_RUN:-}" = "1" ]; then
  say "DRY RUN: would merge PR #$pr ($title) at $head; version $base_version → $version."
  exit 0
fi

gh pr merge "$pr" --repo "$REPO" --squash --delete-branch --match-head-commit "$head" \
  --subject "$title (#$pr)"
merge=$(gh pr view "$pr" --repo "$REPO" --json mergeCommit --jq .mergeCommit.oid)
say "Merged PR #$pr as $merge."

if [ "$version" = "$base_version" ]; then
  say "Version unchanged ($version): generated code did not change, nothing to publish."
  exit 0
fi
if gh api "repos/$REPO/git/ref/tags/v$version" >/dev/null 2>&1; then
  say "Tag v$version already exists; not tagging again."
  exit 0
fi
gh api "repos/$REPO/git/refs" -f ref="refs/tags/v$version" -f sha="$merge" >/dev/null
say "Tagged v$version at $merge: release.yml publishes it to npm."
