#!/usr/bin/env bash

set -euo pipefail

repo="mohsinsurani/quackwrangler"

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login --hostname github.com"
  exit 1
fi

gh repo edit "$repo" --enable-discussions

gh label create "good first issue" --repo "$repo" --color "7057ff" --description "Small, well-scoped work for a first contribution" --force
gh label create "help wanted" --repo "$repo" --color "008672" --description "Community contributions are welcome" --force
gh label create "community" --repo "$repo" --color "0e8a16" --description "Community, contribution, and project-governance work" --force
gh label create "area: ui" --repo "$repo" --color "1d76db" --description "Webview layout, accessibility, and interaction" --force
gh label create "area: duckdb" --repo "$repo" --color "fff200" --description "DuckDB queries, profiling, execution, and performance" --force
gh label create "area: file-formats" --repo "$repo" --color "f9d0c4" --description "File readers, writers, and format compatibility" --force
gh label create "priority: high" --repo "$repo" --color "b60205" --description "High-priority work" --force
gh label create "skip-changelog" --repo "$repo" --color "ededed" --description "Exclude from generated release notes" --force

echo "GitHub Discussions and contributor labels are configured for $repo."
