# fund/compliance/signoffs

Protected zone (`fund/**` per root CLAUDE.md rule 3). Written, dated records of both founders'
explicit approval for the go-live decisions `scripts/ops/preflight.py` (#50/#51) refuses to pass
without: issue #51's "a dated approval from both Satyam and Rohit is recorded... not a blanket
yes for some future, unspecified amount."

## Format

One file per topic below, copied from [`TEMPLATE.md`](TEMPLATE.md). `scripts/ops/preflight.py`
reads each file looking for at least two lines starting with `Approved by:`, each:

- naming one of the two founders -- matched case-insensitively on `satyam` or `rohit` appearing
  anywhere in the line, so either the full name or the `@handle` from
  [docs/TEAM.md](../../../docs/TEAM.md) satisfies it;
- carrying a date in `YYYY-MM-DD` form.

Fewer than two `Approved by:` lines, or the two lines naming the same founder twice instead of
both, or a missing date, fails that sign-off's gate. This is a plain-text, regex-checkable
convention on purpose (matching `scripts/ops/alerts.py` and `autonomy/classify.py`'s "standard
library only" rule for everything under `scripts/`) -- it is not a schema, and it proves a record
exists in the right shape, never that its content is honest. That judgment stays human.

## Required files

| File | Topic | Issue |
|---|---|---|
| `asset.md` | Which instrument the agent trades first, and the cost math behind it | [#21](https://github.com/SatyamDave/fall_forward_labs/issues/21) |
| `budget-caps.md` | Total funding, per-order cap, daily cap, and the canary-phase cap | [#23](https://github.com/SatyamDave/fall_forward_labs/issues/23) |
| `counsel.md` | The lawyer's written answer is on file and both founders accept it | [#24](https://github.com/SatyamDave/fall_forward_labs/issues/24) |
| `shadow-results.md` | The shadow report (#48) clears the founders' pre-agreed bar | [#49](https://github.com/SatyamDave/fall_forward_labs/issues/49) |
| `go-no-go.md` | The final go/no-go for the first live trade, naming the exact cap and asset in effect | [#51](https://github.com/SatyamDave/fall_forward_labs/issues/51) |

## Never create a real sign-off from automated tooling

Each of these files records a human decision that already happened somewhere else -- a
conversation, a signed document, a lawyer's letter -- not something that happens by editing a
file. An agent (or this repository's own automation) must never author, backdate, or fabricate
the content of one of these files; this build's hard limits forbid a real sign-off existing yet at
all. `TEMPLATE.md` exists so a human filling one in by hand has the exact shape
`preflight.py` checks, not so an agent can generate a plausible-looking approval.
