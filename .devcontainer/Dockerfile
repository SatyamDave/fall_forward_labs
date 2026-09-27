# Base: official Rust image (stable channel), Debian bookworm. Pinned by digest, not just a tag,
# so the environment doesn't silently drift. Looked up 2026-09-27 via the Docker Hub registry API
# (multi-arch index digest for the `1-bookworm` tag):
#   curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/rust:pull" \
#     | jq -r .token \
#     | xargs -I{} curl -s -H "Authorization: Bearer {}" \
#         -H "Accept: application/vnd.oci.image.index.v1+json" \
#         https://registry-1.docker.io/v2/library/rust/manifests/1-bookworm -D - -o /dev/null
# `docker` itself is not available in this environment, so this Dockerfile has not been built or
# tested locally — only the base-image lookup and the tool install commands were verified.
FROM rust:1-bookworm@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e

ENV CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/root/.local/bin:$PATH

# uv also manages the Python 3.12 install (research/pyproject.toml pins python = "3.12"), so no
# separate system Python package is needed. https://docs.astral.sh/uv/getting-started/installation/
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && uv python install 3.12

# just: the repo's task runner (justfile at the repo root). https://github.com/casey/just
RUN cargo install just --locked

# cargo-deny / cargo-audit: consumed by `just audit` and CI (Phase 4 security pipeline).
RUN cargo install cargo-deny --locked \
    && cargo install cargo-audit --locked

# pre-commit: run via uv so it doesn't need a separate system Python.
RUN uv tool install pre-commit

# gitleaks: pinned release binary (v8.30.1, latest as of 2026-09-27 per
# `gh api repos/gitleaks/gitleaks/releases/latest`), not a moving tag.
# ponytail: linux_x64 asset only, hardcoded — breaks on an arm64 build host. Switch on
# `dpkg --print-architecture` (x64/arm64) if this devcontainer needs to run on Apple Silicon
# without Rosetta/amd64 emulation.
RUN curl -LsSf -o /tmp/gitleaks.tar.gz \
        https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
    && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
    && rm /tmp/gitleaks.tar.gz \
    && gitleaks version
