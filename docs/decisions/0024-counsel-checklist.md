<!--
This is a decision packet, not a sign-off. It lays out the exact questions for a lawyer, so the
founders (or whoever books the call) don't have to re-derive them from the research files. It is
not signed, and it does not itself change any config, ADR, or gate. It contains no legal
conclusions — every item below is a question to ask, not an answer. See docs/decisions/README.md
for the list of packets and their status.
-->

# Questions for counsel before real money moves (#24)

Related issue: [#24](https://github.com/SatyamDave/fall_forward_labs/issues/24) — "Get a lawyer's
yes before real money moves." Per that issue, a written legal opinion (or a direct written answer
from Robinhood, or both) must be on file and linked from ADR-0040 before the first funded live
trade — this is a hard blocker, no exceptions.

Nothing below is a legal conclusion. Each item names the exact clause, quotes it, and states the
open question — the research files this repository already produced (`robinhood-research.md`,
`robinhood-agentic-mcp.md`, `agent-sdk-research.md`) flag every one of these as **requires
counsel** rather than resolving them.

## Robinhood Customer Agreement questions

Source: Robinhood Financial LLC & Robinhood Securities, LLC Customer Agreement, revised
2026-09-01, https://cdn.robinhood.com/assets/robinhood/legal/Robinhood-Customer-Agreement.pdf
(quoted in `robinhood-agentic-mcp.md` §6 and `robinhood-research.md` §2).

1. **Consent to develop on the API/MCP (§29.1).** *"You may not use the API Package or develop
   Licensee Products without Robinhood's express written consent (and Robinhood may decline any
   such request for use or development in its sole discretion)."* Question: does connecting a
   custom TypeScript service (built with `@anthropic-ai/claude-agent-sdk`) to the public Agentic
   Trading MCP endpoint (`https://agent.robinhood.com/mcp/trading`) count as "using the API
   Package" under an implied consent from Robinhood's own published connection instructions for
   Claude Code/Claude Desktop/etc. — or does it cross into "developing Licensee Products," which
   the clause's text treats as a separate, higher bar? Robinhood's support docs list "other AI
   platforms that support MCP connections" as an explicit catch-all, but do not say whether a
   from-scratch, non-chat client qualifies.

2. **Personal, non-business use only (§4.11, §29.7(d)).** *"You may only use the Platform for your
   own personal, non-business, non-commercial use"* and *"access and use of the API Products is
   solely for your own personal use and not for any other purposes."* Question: is each founder
   trading their own Agentic account, using code the two of them jointly built as a startup, still
   "personal use" — or does building/operating this as the startup's product/deliverable (even
   while trading only the founders' own money) make it "business use" under the plain text?

3. **Final-and-binding autonomous-agent instructions and manipulation-law risk (§29.8).** *"Any
   instruction submitted to Robinhood from an authenticated session of your AI agent shall be final
   and binding upon you upon receipt by Robinhood"* and *"you assume full responsibility for
   [market manipulation, spoofing, layering, wash trading, marking the close]... regardless of
   whether such conduct was intended by you."* Question: does the risk-wrapped gateway's own
   safeguards (self-cross prevention, wash-trade detection window, per-order/daily caps — see
   `docs/decisions/0023-budget-and-caps.md`) meaningfully reduce this exposure in counsel's view, or
   is there anything else a lawyer would want built or documented before this clause's risk is
   acceptable?

4. **Revocation is not retroactive (§29.8).** *"You shall remain bound by, and Robinhood shall have
   no obligation to cancel, reverse, or unwind, any instruction submitted by such agent and received
   by Robinhood prior to the effective processing of such revocation."* Question: is there anything
   beyond the kill switch stopping new intents at our own gateway (rather than relying on
   disconnecting the agent in the Robinhood app) that counsel would recommend, given this clause?

## Anthropic usage-policy question

Source: Anthropic Usage Policy, https://www.anthropic.com/legal/aup, and Commercial Terms of
Service, https://www.anthropic.com/legal/commercial-terms (both quoted in `agent-sdk-research.md`
§7, fetched 2026-09-27).

5. **High-risk financial decisions.** The Usage Policy's High-Risk Use Case category names
   *"financial decisions, including investment advice, loan approvals, and determining financial
   eligibility"* and requires, for High-Risk Use Cases generally, that *"a qualified professional in
   that field must review the content or decision prior to dissemination."* Question: does this
   clause reach a firm's own proprietary/systematic trading of its own founders' capital — where
   there is no external "end user" receiving advice — or is it aimed at consumer-facing
   investment-advice products? And separately: can the deterministic risk engine and kill switch
   (which independently checks every proposed order before it reaches a venue, per ADR-0040 §1,
   "risk is authoritative, not advisory") satisfy "a qualified professional... review[s] the...
   decision prior to dissemination," or does this clause require an actual human reviewing each
   decision?

## Entity and tax questions (see also #71)

6. **Founders' agreement and account ownership.** Whose personal Robinhood account funds the
   canary amount, and how gains or losses (if any) are shared between founders — see
   `docs/decisions/0071-entity-and-tax.md` for why this needs its own professional advice (an
   accountant, not necessarily the same lawyer) and why sharing P&L between founders may itself
   raise the pooled-fund/investment-adviser questions below.

7. **Investment adviser / commodity pool exposure (general, not Robinhood-specific).** SEC:
   an investment adviser is a person "in the business of providing investment advice to others
   about securities... as part of a regular business" (https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/investment-advisers,
   quoted in `robinhood-research.md` §3). CFTC: a commodity pool is funds from multiple people
   combined for futures/swaps trading, and its operator must register unless exempt under Reg 4.5
   or the small-pool exemption in Reg 4.13 (up to 15 participants and $400,000)
   (https://www.cftc.gov/sites/default/files/tm/tmcpo_cta_exemptions.htm, same file). Question:
   does one founder's code trading the other founder's account, or any pooling of the two founders'
   money into one account, trip either regime — and does the answer change if losses/gains are
   split between the founders versus each founder bearing only their own?

8. **Tax reporting.** Securities go on Form 1099-B; crypto sales on or after 2025-01-01 go on Form
   1099-DA (`robinhood-research.md` §3, citing Robinhood's wash-sales and crypto-tax help articles).
   Question for an accountant, not necessarily the lawyer: how should each founder's personal
   Agentic-account activity be reported given that the trading code is jointly built and jointly
   operated?

## What this packet is not

This packet does not answer any of the eight questions above — every one is marked **requires
counsel** in the underlying research (`robinhood-research.md`, `robinhood-agentic-mcp.md`,
`agent-sdk-research.md`) precisely because no primary source resolves it. Issue #24's own done-when
requires a dated, written opinion answering these specific questions (not a general "looks fine"),
filed in `fund/compliance/` and linked from ADR-0040, before the first funded live trade — see
`fund/compliance/README.md` ("Investor-facing content gets legal review and is never written by
agents alone") and `fund/compliance/signoffs/counsel.md`'s eventual sign-off record (not yet
created; see `fund/compliance/signoffs/README.md`).

---

# Counsel-checklist sign-off (#24)

Related issue: #24

Decision: <what was actually decided, in plain language -- that the written opinion is on file and
both founders accept it, with the filed document's path, not "looks good">

Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
