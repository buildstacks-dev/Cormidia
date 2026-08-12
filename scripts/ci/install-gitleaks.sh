#!/usr/bin/env bash
set -euo pipefail

: "${GITLEAKS_VERSION:?GITLEAKS_VERSION is required}"
: "${GITLEAKS_SHA256_X64:?GITLEAKS_SHA256_X64 is required}"
: "${GITLEAKS_SHA256_ARM64:?GITLEAKS_SHA256_ARM64 is required}"

case "$(uname -m)" in
  x86_64)
    readonly ARCHIVE_ARCH="x64"
    readonly ARCHIVE_SHA256="${GITLEAKS_SHA256_X64}"
    ;;
  aarch64 | arm64)
    readonly ARCHIVE_ARCH="arm64"
    readonly ARCHIVE_SHA256="${GITLEAKS_SHA256_ARM64}"
    ;;
  *)
    echo "unsupported gitleaks architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

readonly ARCHIVE="gitleaks_${GITLEAKS_VERSION}_linux_${ARCHIVE_ARCH}.tar.gz"
curl --fail --show-error --silent --location \
  --output gitleaks.tar.gz \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${ARCHIVE}"
echo "${ARCHIVE_SHA256}  gitleaks.tar.gz" | sha256sum --check --strict
tar --extract --gzip --file gitleaks.tar.gz gitleaks
./gitleaks version | grep --quiet --fixed-strings --line-regexp "${GITLEAKS_VERSION}" || {
  echo "gitleaks version mismatch — refusing to run an unpinned scanner" >&2
  exit 1
}
