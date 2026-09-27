#!/usr/bin/env bash
# Open one `knowledge` PR from a patch that a read-only Claude job produced.
# Runs in a job with no Claude step: the scope check is copied from this clean
# checkout before the patch is applied, so a patch cannot rewrite its own check.
# Usage: open_pr.sh <dir with changes.patch and optional pr-body.md> <branch> <title>
set -euo pipefail

dir=$1
branch=$2
title=$3
base=${BASE_BRANCH:-main}

if [ ! -s "$dir/changes.patch" ]; then
  echo "No changes proposed; nothing to open."
  exit 0
fi
if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  echo "::notice::Branch $branch already exists; not opening a second PR."
  exit 0
fi

checker=$(mktemp)
cp scripts/knowledge/scope_check.py "$checker"

git switch -c "$branch"
git apply --index "$dir/changes.patch"
git diff --cached --name-only --no-renames | python3 "$checker"

git -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --quiet -m "$title"
git push origin "$branch"

body=$(mktemp)
if [ -s "$dir/pr-body.md" ]; then cat "$dir/pr-body.md" >"$body"; fi
printf '\n\nProposed by %s run %s/%s/actions/runs/%s. Review before merging; nothing here merges itself.\n' \
  "$GITHUB_WORKFLOW" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" >>"$body"

gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body" --label knowledge
