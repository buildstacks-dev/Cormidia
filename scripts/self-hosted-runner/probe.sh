#!/usr/bin/env bash
set -euo pipefail

[[ "${RUNNER_OS:-}" == "Linux" ]]
[[ "${RUNNER_ARCH:-}" == "ARM64" ]]
[[ "$(uname -m)" == "aarch64" ]]
[[ -r /run/cormidia-runner/network-isolated ]]
[[ ! -e /var/run/docker.sock ]]
[[ -z "${RUNNER_TOKEN:-}" ]]

CAP_EFFECTIVE="$(awk '/^CapEff:/ { print $2 }' /proc/self/status)"
[[ "${CAP_EFFECTIVE}" == "0000000000000000" ]]

WORKSPACE_FS="$(findmnt --noheadings --output FSTYPE --target "${GITHUB_WORKSPACE}" | tr -d ' ')"
[[ "${WORKSPACE_FS}" == "overlay" ]]

git -C "${GITHUB_WORKSPACE}" rev-parse --is-inside-work-tree | grep -qx true
git -C "${GITHUB_WORKSPACE}" diff --check

{
  echo "### Self-hosted runner probe"
  echo
  echo "- OS/architecture: Linux ARM64"
  echo "- Workspace filesystem: overlay (no host mount)"
  echo "- Effective capabilities: none"
  echo "- Docker socket: absent"
  echo "- Private/link-local egress guard: installed"
  echo "- Registration token in job environment: absent"
} >> "${GITHUB_STEP_SUMMARY}"
