# Week 1

By the end of week 1, you should be able to make a real contribution to at least one area below
without a teammate walking you through it step by step.

## Pick a track

**Engine.** Read all of `engine/crates/{core,orderbook,oms}/`. Understand the order state
machine (`oms`) and why it has no wildcard match arms. Run `just bench` and read one criterion
report. Try `engine/.claude/skills/replay-debug` on a failing replay (ask for a fixture if none
exists yet).

**Research / ML.** Read `research/README.md` and `ml/README.md`. Walk through
`docs/research/graveyard.md` and the experiment registry (`research/registry/`) — every trial,
including failures, is recorded there. Run `.claude/skills/run-walkforward` (or read it if the
`walkforward` recipe isn't wired up yet) to see what a validated result has to report: net Sharpe
after costs, deflated Sharpe using the *true* trial count, PBO, max drawdown, turnover.

**Agents / tooling.** Read `.claude/` end to end: `settings.json`, `hooks/`, `rules/`, `agents/`,
`skills/`. Try starting a Claude Code session from inside `engine/crates/risk/` and run `/context`
— confirm you see the root `CLAUDE.md`, the `engine` one, the `risk` one, and `risk-guard.md` all
loaded, and nothing you didn't expect.

## Understand the lifecycle gates

Every strategy idea moves through idea → research → backtest → walk-forward → paper → canary →
scaled (`strategies/_template/GATES.md`). Skipping a gate is a blocking error, not a style
preference. Find a strategy (or the template) and trace which gate it's at and what's missing to
advance.

## Understand the knowledge loop

Read `docs/onboarding/how-this-repo-learns.md`. Find a real entry in a nested `CLAUDE.md`
"Learned" section and trace it back to the PR or postmortem it came from.

## By Friday

- You've opened at least one PR that isn't a typo fix.
- You know which zones are protected and why, and you haven't tried to route around
  `guard-protected.sh`.
- You know where the experiment registry and graveyard are, and you check them before proposing
  something that sounds new.
- You know the difference between what the engine does today and what's still a `justfile`
  placeholder printing "not implemented yet" — don't assume a recipe exists because it's listed.
