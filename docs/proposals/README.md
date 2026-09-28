# Proposals

Each file here is a prepared change that needed a decision or touched a protected path. Apply one with `git apply docs/proposals/<file>.patch` from the repo root after the named authorization, in its own PR.

Status 2026-09-28: 0002 and 0003 are **applied** on `main` with the owner's approval (the patch files stay as a record; `git apply --check` now fails because the change is already in). 0001 is **not applied**.

| Patch | What it changes | Status | Needs |
|---|---|---|---|
| `0001-rust-toolchain-pin.patch` | `engine/rust-toolchain.toml` from `channel = "stable"` to `"1.98.1"`, and the matching sentence in `engine/fuzz/README.md` | Not applied: ADR-0004 is Proposed | A human approving ADR-0004's pin |
| `0002-ai-workflow-gating.patch` | A `gate` job running `scripts/ci/ai_gate.py` in knowledge-sync, learnings-triage, gardener and ai-review; the paid jobs run only on `run == 'true'` with turns, dollars and timeout from the policy; a disabled, zero-budget `loop-review` entry in `autonomy/POLICY.yaml` | Applied 2026-09-28 (owner approval; protected, T3) | nothing |
| `0003-codeowners-order.patch` | Moves the `*` catch-all in `.github/CODEOWNERS` to the top so protected-zone lines win (last match wins), and corrects the header's claim that a ruleset enforces two approvals | Applied 2026-09-28 (owner approval; protected, T3) | nothing |

## Current toolchain reality (2026-09-27)

- Rust: `engine/rust-toolchain.toml` says `stable`, which floats. CI's `rustup toolchain install` gets whatever stable is current on the day it runs. The devcontainer base image is pinned by digest (`rust:1-bookworm@sha256:93ce27...`), which fixes the compiler baked into that image, but rustup inside it still resolves `stable` for `engine/` to the current release. Local verification ran on Homebrew rustc 1.97.1 without rustup, which ignores the toolchain file. No two of these are guaranteed to match.
- Python: `research/.python-version` says `3.12` and `requires-python = ">=3.12"`; uv resolved CPython 3.12.13 locally. The patch release is not pinned.
