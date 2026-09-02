#!/usr/bin/env bash
# Bump version, commit, tag, and push — GitHub Action publishes automatically.
set -euo pipefail
VERSION="${1:-patch}"
npm version $VERSION
git push --follow-tags
echo "Pushed tag. GitHub Action will publish to npm."