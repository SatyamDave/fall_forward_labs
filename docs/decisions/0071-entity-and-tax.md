<!--
This is a decision packet, not a sign-off. It lays out what still needs a decision and states
plainly that professional advice is required — it draws no legal or tax conclusions itself. It is
not signed, and it does not itself change any config, ADR, or gate. See docs/decisions/README.md
for the list of packets and their status.
-->

# Entity, account ownership, and tax (#71)

Related issue: [#71](https://github.com/SatyamDave/fall_forward_labs/issues/71) — "Make real money
legally clean for everyone." Depends on [#24](https://github.com/SatyamDave/fall_forward_labs/issues/24)
(counsel review) per that issue's own text.

## Why a single founder isn't enough here

This repository is currently a solo effort in the sense that matters for this question:
`docs/TEAM.md` states plainly that Rohit (`@rovivek`) is only "assumed from the collaborator
list," has not yet added themselves to the team file, and has not yet reviewed or approved
ADR-0040 (the decision that puts an agent in the trade-decision path in the first place). *"No
document in this repository should name, describe or assign work to a second founder beyond what
this file states, until they add themselves here in their own PR."* Real money and a real
brokerage account under one founder's name create real legal and tax consequences for that person
specifically — this is exactly the kind of decision root CLAUDE.md rule 3 already treats as
requiring human approval (`fund/**` is a protected zone), and it is squarely outside what an
agent, or this repository's own automation, can resolve. `fund/compliance/signoffs/README.md` says
this directly: these are "written, dated records of both founders' explicit approval," never
authored or fabricated by an agent.

## What still needs a decision, each requiring professional advice

1. **Entity.** Does this trading activity happen through an existing or new legal entity (LLC,
   partnership, etc.), or purely through each founder's personal brokerage account? Nothing in this
   repository states or assumes an entity exists — `robinhood-research.md` §3's read of the
   Robinhood Agentic account is that it is "a self-directed, individual investing account,"
   individual by construction, not an entity account. Whether the *company* (however it's
   structured) should sit behind that personal account in any way is a question for a lawyer, not
   this codebase.
2. **Account ownership.** Whose personal Robinhood account funds the canary amount
   (`docs/decisions/0023-budget-and-caps.md`)? Issue #71's own done-when requires this to be
   "clearly named."
3. **Gains/losses sharing.** Do the founders share P&L from this trading at all, or does each
   founder bear only their own account's results? This is not a neutral technical choice:
   `robinhood-research.md` §3 flags that "one founder's code trading the other founder's account,"
   or pooling money/results between them, moves toward the SEC's investment-adviser definition or
   the CFTC's commodity-pool-operator regime (Reg 4.13's small-pool exemption caps at 15
   participants and $400,000) — the same open question named in
   `docs/decisions/0024-counsel-checklist.md` question 7. "Each founder trading their own account,
   with their own decisions, using a shared piece of code they built" is the reading the research
   calls least risky, but that is not a legal conclusion this repository can make on its own.
4. **Tax reporting.** Robinhood reports securities sales on Form 1099-B and, for crypto sales on or
   after 2025-01-01, on Form 1099-DA (`robinhood-research.md` §3, citing Robinhood's own wash-sales
   and crypto-tax help articles: https://robinhood.com/us/en/support/articles/wash-sales/ and
   https://robinhood.com/us/en/support/articles/crypto-tax-FAQ/). Wash-sale tracking is per-Robinhood-account,
   not cross-account or cross-broker, and whether wash-sale rules even apply to crypto specifically
   is unverified in the research to date (`robinhood-research.md` §3: "requires counsel / tax
   advisor"). How each founder's personal Agentic-account activity should be reported — and whether
   any inter-founder P&L sharing arrangement itself has tax consequences — needs an accountant's
   direct answer, not an inference from Robinhood's help pages.

## What this packet explicitly does not do

It does not pick an entity, does not name whose account funds the canary, does not decide whether
P&L is shared, and does not state a tax position. Every one of the four items above needs
professional advice — a lawyer for entity/ownership/pooling questions, an accountant for tax
reporting — and issue #71 depends on the counsel review in issue #24
(`docs/decisions/0024-counsel-checklist.md`) being done first, since several of the same clauses
(personal-use-only, pooled-fund exposure) are shared between the two questions.

## What "done" looks like, per issue #71

- A signed founders' agreement (covering IP, money, roles, and who controls the accounts and keys)
  exists, stored **outside this repository** — `fund/compliance/README.md`'s own convention is that
  investor-facing and legal content gets human legal review and is never written by agents alone.
- Its existence (not its contents) is recorded in `docs/TEAM.md`.
- The canary account owner is named, once decided.

This packet's job is to lay out what still needs deciding and state clearly that it needs a lawyer
and an accountant, not this codebase, to decide it.

---

# Entity-and-tax sign-off (#71)

Related issue: #71

Decision: <what was actually decided, in plain language -- entity (if any), which founder's
account funds the canary, whether gains/losses are shared, and that the signed agreement is stored
outside the repo, not "looks good">

Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
