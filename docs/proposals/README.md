# Proposals awaiting authorization

Each file here is a prepared change that is **not applied**, because it needs a decision or touches a protected path. Apply one with `git apply docs/proposals/<file>.patch` from the repo root after the named authorization, in its own PR, and delete the patch file in that PR.

| Patch | What it changes | Why it is not applied | Needs |
|---|---|---|---|
| `0001-rust-toolchain-pin.patch` | `engine/rust-toolchain.toml` from `channel = "stable"` to `"1.98.1"`, and the matching sentence in `engine/fuzz/README.md` | ADR-0004 is Proposed, not approved | A human approving ADR-0004's pin |

## Current toolchain reality (2026-09-27)

- Rust: `engine/rust-toolchain.toml` says `stable`, which floats. CI's `rustup toolchain install` gets whatever stable is current on the day it runs. The devcontainer base image is pinned by digest (`rust:1-bookworm@sha256:93ce27...`), which fixes the compiler baked into that image, but rustup inside it still resolves `stable` for `engine/` to the current release. Local verification ran on Homebrew rustc 1.97.1 without rustup, which ignores the toolchain file. No two of these are guaranteed to match.
- Python: `research/.python-version` says `3.12` and `requires-python = ">=3.12"`; uv resolved CPython 3.12.13 locally. The patch release is not pinned.
