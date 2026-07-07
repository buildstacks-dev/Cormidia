#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GH_SANDBOX_REPO:-}" ]]; then
  echo "GH_SANDBOX_REPO is required (owner/repo)" >&2
  exit 2
fi

repo="$GH_SANDBOX_REPO"

if ! gh repo view "$repo" >/dev/null 2>&1; then
  gh repo create "$repo" --private >/dev/null
fi

# Fetch the full label set once from the strongly-consistent list endpoint.
# Do NOT use `gh label list --search <name>` per-label: that hits the fuzzy,
# eventually-consistent search index, which can transiently return an
# incomplete set — so an existing label reads as missing, `gh label create`
# then fails with "already exists", and `set -e` aborts the whole setup. That
# breaks the idempotency contract (a second run must be a no-op).
existing_labels="$(gh label list --repo "$repo" --limit 200 --json name --jq '.[].name')"

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  # Exact-match against the captured list via a here-string (no pipe, so no
  # SIGPIPE/pipefail interaction either).
  if grep -Fxq -- "$name" <<<"$existing_labels"; then
    return 0
  fi
  gh label create "$name" --repo "$repo" --color "$color" --description "$description" >/dev/null
  existing_labels="$existing_labels"$'\n'"$name"
}

ensure_label "op:ready" "2da44e" "Operon ticket is ready to build"
ensure_label "op:building" "1f6feb" "Operon ticket is claimed or being built"
ensure_label "op:in-review" "8250df" "Operon ticket has an open PR under review"
ensure_label "op:returned" "d29922" "Operon ticket returned to Planner"
ensure_label "op:blocked" "cf222e" "Operon ticket waiting on approval"
ensure_label "op:incident" "b60205" "Operon SRE incident note"
ensure_label "op:tier-quick" "a5d6ff" "Quick ticket tier"
ensure_label "op:tier-standard" "54aeff" "Standard ticket tier"
ensure_label "op:tier-deep" "0a3069" "Deep ticket tier"
ensure_label "p1" "cf222e" "Priority 1"
ensure_label "p2" "d29922" "Priority 2"
ensure_label "p3" "2da44e" "Priority 3"

echo "sandbox repo ready: $repo"
