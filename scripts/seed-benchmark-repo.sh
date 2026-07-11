#!/usr/bin/env bash
# Seed the Stage 7 benchmark fixture (docs/proportionality-review.md §5;
# fixture decision: docs/approval-and-release-amendment.md — a disposable
# repository per run, created from pinned inputs, no state bleed).
#
# Usage: GH_BENCH_REPO=<owner/repo> bash scripts/seed-benchmark-repo.sh
# Idempotent: re-running resets the repo content to the pinned seed.
set -euo pipefail

if [[ -z "${GH_BENCH_REPO:-}" ]]; then
  echo "GH_BENCH_REPO is required (owner/repo)" >&2
  exit 2
fi

repo="$GH_BENCH_REPO"

if ! gh repo view "$repo" >/dev/null 2>&1; then
  gh repo create "$repo" --private >/dev/null
  echo "created $repo"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git init -q "$work"
cd "$work"

# Pinned product inputs — the same class of ask as the 2026-07-10 episode
# (a personal website), with the product truth the Planner needs and nothing
# else: no branch, no PR, no lockfile, no dependency cache, no worktree.
cat > README.md <<'DOC'
# Meridian — personal site for a founder

A small, fast personal website: a landing page introducing the founder,
a short bio, and a list of projects. Static hosting, no backend, no user
accounts, no payments.
DOC

mkdir -p docs
cat > docs/product.md <<'DOC'
# Product overview

Audience: people who meet the founder and want one page that says who they
are and what they build.

Must have (first milestone):
- A landing page with the founder's name, a one-line positioning statement,
  a short bio section, and a projects list (3 placeholder entries are fine).
- Site builds statically and passes its own test/lint commands.
- Repository is deployable to any static host; deployment itself is a later
  milestone (this milestone intentionally ends at merge).

Explicitly out of scope for the first milestone: analytics, RSS, custom
domain, CMS, contact forms, blog.
DOC

git add -A
git -c user.name="Operon Benchmark" -c user.email="bench@localhost" \
  commit -qm "seed: pinned benchmark product inputs"
git branch -M main
git remote add origin "https://github.com/$repo.git"
git push -qf origin main

echo "benchmark repo seeded: $repo (pinned inputs, force-reset to seed)"
