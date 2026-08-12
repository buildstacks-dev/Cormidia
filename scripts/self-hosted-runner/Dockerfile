FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

ARG RUNNER_VERSION=2.336.0
ARG RUNNER_SHA256=58b758e420b87093fbd4bfddd368074960053e2f1388f01848c82624b90f27d1

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_USE_SYSTEM_CA=1

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gzip \
    iptables \
    jq \
    libatomic1 \
    tar \
    tini \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 runner \
  && useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash runner \
  && mkdir --parents /actions-runner \
  && curl --fail --show-error --silent --location \
    --output /tmp/actions-runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz" \
  && echo "${RUNNER_SHA256}  /tmp/actions-runner.tar.gz" | sha256sum --check --strict \
  && tar --extract --gzip --file /tmp/actions-runner.tar.gz --directory /actions-runner \
  && rm /tmp/actions-runner.tar.gz \
  && /actions-runner/bin/installdependencies.sh \
  && chown --recursive runner:runner /actions-runner /home/runner

COPY --chmod=755 entrypoint.sh /usr/local/bin/cormidia-runner-entrypoint

WORKDIR /actions-runner
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cormidia-runner-entrypoint"]
