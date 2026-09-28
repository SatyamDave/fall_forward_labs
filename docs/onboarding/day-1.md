# Day 1

Goal: get the repo running and understand the shape of the system, without touching anything
protected.

## 1. Get the environment working

```sh
just setup
just check
just replay
```

If any of these fail on a fresh clone, that's a bug — open an issue with the failing command's
output, don't work around it silently. If you don't have `just`, `cargo`, or `uv` installed
locally, use `.devcontainer/` instead of installing them by hand.

## 2. Read, in this order

1. `docs/VISION.md` — the mission and the constraints that shape every other decision here
   (no live agent in the order path, no secrets in git, gated strategy lifecycle, kill switch).
2. Root `CLAUDE.md` — the twelve non-negotiable rules, verbatim, plus the repo map.
3. `docs/ARCHITECTURE.md` — how `engine/`, `research/`, `ml/`, and `agents/` fit together.
4. `docs/GLOSSARY.md` — skim it once now; you'll come back to it.

## 3. Find your bearings in the code

- Read `engine/crates/core/` — the fixed-point `Price`/`Qty` types and events everything else is
  built from. Notice there's no `f64` anywhere near money.
- Skim `engine/crates/risk/` (protected — read-only for now) to see the shape of a risk check.
- Look at `strategies/_template/` — this is what a strategy looks like at every lifecycle gate.

## 4. Understand what you can and can't touch

Read the "Protected zones" section of `CONTRIBUTING.md`. On day 1, plan to work outside them.
Everything else is fair game for a small, well-tested PR.

## 5. Make a trivial PR

Fix a typo, improve a doc, add a test for something uncovered. Go through the real flow: branch,
commit with a conventional message, fill in the PR template, open the PR. The goal isn't the
change — it's confirming CI, the PR template, and review actually work for you before you touch
anything that matters.

Next: `docs/onboarding/week-1.md`.
