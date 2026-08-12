#!/usr/bin/env bash
set -euo pipefail

readonly NETWORK_GUARD_MARKER="/run/cormidia-runner/network-isolated"

install_network_guard() {
  mkdir -p "$(dirname "${NETWORK_GUARD_MARKER}")"
  while read -r resolver; do
    [[ "${resolver}" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || continue
    iptables --wait --append OUTPUT --protocol udp --destination "${resolver}/32" --dport 53 --jump ACCEPT
    iptables --wait --append OUTPUT --protocol tcp --destination "${resolver}/32" --dport 53 --jump ACCEPT
  done < <(awk '/^nameserver[[:space:]]/ { print $2 }' /etc/resolv.conf)
  for cidr in \
    10.0.0.0/8 \
    100.64.0.0/10 \
    169.254.0.0/16 \
    172.16.0.0/12 \
    192.168.0.0/16; do
    iptables --wait --append OUTPUT --destination "${cidr}" --jump REJECT
  done
  printf 'private and link-local egress denied before capability drop\n' > "${NETWORK_GUARD_MARKER}"
  chmod 0444 "${NETWORK_GUARD_MARKER}"
}

run_as_runner() {
  : "${RUNNER_URL:?RUNNER_URL is required}"
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
  : "${RUNNER_NAME:?RUNNER_NAME is required}"
  : "${RUNNER_LABEL:?RUNNER_LABEL is required}"

  ./config.sh \
    --unattended \
    --ephemeral \
    --disableupdate \
    --no-default-labels \
    --url "${RUNNER_URL}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABEL}" \
    --work _work

  exec env -u RUNNER_TOKEN ./run.sh
}

if [[ "${1:-}" == "--as-runner" ]]; then
  run_as_runner
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "runner entrypoint must begin as root to install the egress guard" >&2
  exit 1
fi

install_network_guard
exec setpriv \
  --reuid=1001 \
  --regid=1001 \
  --init-groups \
  --bounding-set=-all \
  --inh-caps=-all \
  --ambient-caps=-all \
  /usr/local/bin/cormidia-runner-entrypoint --as-runner
