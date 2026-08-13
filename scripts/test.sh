#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")/.."

temp_parent="${TMPDIR:-/tmp}"
temp_parent="${temp_parent%/}"
git_askpass="$(type -P false)"
vitest_bin="$PWD/node_modules/.bin/vitest"
tsx_bin="$PWD/node_modules/.bin/tsx"
pnpm_store="$(pnpm store path --silent)"
if [[ -n "${COREPACK_HOME-}" ]]; then
  corepack_home="$COREPACK_HOME"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  corepack_home="$HOME/Library/Caches/node/corepack"
else
  corepack_home="${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack"
fi
readonly temp_parent git_askpass vitest_bin tsx_bin pnpm_store corepack_home

if [[ ! -x "$vitest_bin" ]]; then
  printf "Vitest is not installed at %s; run pnpm install first.\n" "$vitest_bin" >&2
  exit 1
fi
if [[ ! -x "$tsx_bin" ]]; then
  printf "Test preflight runner is not installed at %s; run pnpm install first.\n" "$tsx_bin" >&2
  exit 1
fi

test_root="$(mktemp -d "$temp_parent/cormidia-test.XXXXXX")"
readonly test_root
mkdir -p "$test_root/home/.config" "$test_root/tmp" "$test_root/cache/pnpm"
touch "$test_root/.cormidia-test-owned" "$test_root/npm-globalconfig"
printf "store-dir=%s\n" "$pnpm_store" > "$test_root/npm-userconfig"

cleanup() {
  local exit_code=$?
  trap - EXIT

  case "$test_root" in
    "$temp_parent"/cormidia-test.*)
      if [[ -d "$test_root" && ! -L "$test_root" && -f "$test_root/.cormidia-test-owned" ]]; then
        rm -rf -- "$test_root"
      else
        printf "Refusing to remove unverified test directory: %s\n" "$test_root" >&2
        [[ $exit_code -ne 0 ]] || exit_code=1
      fi
      ;;
    *)
      printf "Refusing to remove unexpected test directory: %s\n" "$test_root" >&2
      [[ $exit_code -ne 0 ]] || exit_code=1
      ;;
  esac

  exit "$exit_code"
}
trap cleanup EXIT

test_env=(
  "PATH=$PATH"
  "PWD=$PWD"
  "HOME=$test_root/home"
  "USERPROFILE=$test_root/home"
  "TMPDIR=$test_root/tmp"
  "TMP=$test_root/tmp"
  "TEMP=$test_root/tmp"
  "XDG_CONFIG_HOME=$test_root/home/.config"
  "XDG_CACHE_HOME=$test_root/cache"
  "LANG=C"
  "LC_ALL=C"
  "TZ=UTC"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_CONFIG_GLOBAL=/dev/null"
  "GIT_TERMINAL_PROMPT=0"
  "GIT_ASKPASS=$git_askpass"
  "GIT_EDITOR=true"
  "GIT_SEQUENCE_EDITOR=true"
  "NPM_CONFIG_USERCONFIG=$test_root/npm-userconfig"
  "NPM_CONFIG_GLOBALCONFIG=$test_root/npm-globalconfig"
  "PNPM_HOME=$test_root/cache/pnpm"
  "PNPM_CONFIG_STORE_DIR=$pnpm_store"
  "COREPACK_HOME=$corepack_home"
  "COREPACK_ENABLE_NETWORK=0"
  "AWS_EC2_METADATA_DISABLED=true"
)

for platform_name in SystemRoot SYSTEMROOT WINDIR COMSPEC PATHEXT; do
  platform_value="${!platform_name-}"
  [[ -z "$platform_value" ]] || test_env+=("$platform_name=$platform_value")
done

for ci_name in CI GITHUB_ACTIONS; do
  ci_value="${!ci_name-}"
  [[ -z "$ci_value" ]] || test_env+=("$ci_name=$ci_value")
done

if [[ "${1-}" == "--probe-environment" ]]; then
  test_command=(
    node
    -e
    'const credentialKeys = Object.keys(process.env).filter((name) => /(API_KEY|TOKEN|SECRET|OPENAI|ANTHROPIC|GOOGLE|GEMINI|AWS_.*(KEY|TOKEN|SECRET)|GITHUB_TOKEN|GH_TOKEN)/i.test(name)).sort(); console.log(JSON.stringify({ credentialKeys, home: process.env.HOME, pathPresent: Boolean(process.env.PATH), timezone: process.env.TZ }));'
  )
  echo "Running offline test-environment probe in isolated home: $test_root/home" >&2
  env -i "${test_env[@]}" "${test_command[@]}"
else
  echo "Running deterministic offline test preflight in isolated home: $test_root/home" >&2
  preflight_args=("$tsx_bin" "$PWD/scripts/test-preflight.ts" --vitest "$vitest_bin" --store-dir "$pnpm_store" -- run "$@")
  env -i "${test_env[@]}" "${preflight_args[@]}"
fi
