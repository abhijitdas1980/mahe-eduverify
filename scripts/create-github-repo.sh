#!/usr/bin/env bash
# Create mahe-eduverify on your personal GitHub and push.
set -euo pipefail

REPO_NAME="${1:-mahe-eduverify}"
VISIBILITY="${2:-public}"

cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null; then
  echo "Install GitHub CLI: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  OLD=$(git remote get-url origin)
  echo "Removing existing origin: $OLD"
  git remote remove origin
fi

echo "Creating github.com/$(gh api user -q .login)/${REPO_NAME} (${VISIBILITY})..."

gh repo create "$REPO_NAME" \
  --"$VISIBILITY" \
  --source=. \
  --remote=origin \
  --description "MAHE EduVerify — admission document pre-verification portal (Azure)" \
  --push

git checkout -b uat 2>/dev/null || git checkout uat
git push -u origin uat
git checkout main

echo ""
echo "Done: https://github.com/$(gh api user -q .login)/${REPO_NAME}"
echo "Next: add AZURE_CREDENTIALS secret → run Deploy MAHE UAT workflow"
