<!--
This is a decision packet, not a sign-off. It lays out the options and a recommendation for the
founders to read and decide. It is not signed, and it does not itself change any config, ADR, or
gate. See docs/decisions/README.md for the list of packets and their status.
-->

# The deflated Sharpe ratio threshold for going live (#22)

Related issue: [#22](https://github.com/SatyamDave/fall_forward_labs/issues/22) — "Agree how good
a strategy must be to go live."

## What the deflated Sharpe ratio (DSR) is

A regular (observed) Sharpe ratio can look good purely by luck if you tried enough strategy
variants — the more backtests you run, the more likely one of them clears any fixed bar by chance
alone. The Deflated Sharpe Ratio, from David H. Bailey and Marcos López de Prado, "The Deflated
Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality," *Journal of
Portfolio Management* 40(5), 2014 (https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551;
paper text also at https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf), corrects the
observed Sharpe for exactly that: how many trials you actually ran, the variance across those
trials, and the return distribution's skew and kurtosis (real returns aren't normal). The output
is a **probability** in [0, 1]: the probability that the strategy's true Sharpe ratio exceeds zero
(or a chosen benchmark), after that correction. A DSR near 1.0 means "very likely genuinely
skillful"; a DSR near 0.5 means "indistinguishable from the best result you'd expect by chance
alone given how many times you tried."

This repository already implements the formula: `ml/validation/__init__.py`'s `deflated_sharpe()`
function cites the same paper by name and equation numbers, and takes the true trial count from
the experiment registry (`registry.trial_count`), not a number a strategy author could
under-report.

## The conventional threshold: 0.95

The commonly cited practical bar in the literature that uses this statistic is **DSR ≥ 0.95** —
read as roughly 95% confidence that the strategy's true Sharpe ratio is positive (or above the
comparison benchmark) after correcting for the number of trials and the non-normality of returns.
Values in the 0.50–0.90 range are treated as weak evidence, consistent with overfitting; values
below 0.50 mean the observed Sharpe is below what you'd expect the best of that many random trials
to produce anyway. (Bailey & López de Prado 2014, as summarized in secondary treatments including
https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio — the underlying formula and its 0.95
convention are widely used across quant-research practice, not unique to one source.)

## Why this repository cannot skip the question

The gate already exists in code, but the threshold is a placeholder, not a decision:

- `ml/validation/walkforward.py` line 45: `GATE_DSR, GATE_PBO, GATE_POSITIVE_FOLDS = 1.0, 0.20, 0.70`,
  with the comment immediately above it: *"deflated_sharpe returns a probability, so GATE_DSR = 1.0
  is met only when the normal CDF saturates... it fails closed until a human sets the threshold as
  a probability."*
- `strategies/_template/GATES.md`'s walk-forward → paper row states the same thing in the gate
  table itself: *"Deflated Sharpe... ≥ 1.0, unreachable in practice; threshold pending a human
  decision."*

In other words, the current default is deliberately impossible to pass — it fails closed rather
than silently letting a strategy through on an arbitrary number nobody chose. That is the correct
posture until this decision is made, but it also means no strategy can reach `paper` today without
a human picking a real threshold.

## Options

1. **Adopt the conventional 0.95.** Matches common practice in the literature this repository
   already cites for the underlying formula. Straightforward to defend if asked why this number.
2. **A stricter threshold (e.g. 0.99).** More conservative; fewer strategies pass, but higher
   confidence in the ones that do. Costs more false negatives (a genuinely good strategy rejected)
   for fewer false positives.
3. **A looser threshold (e.g. 0.90), paired with a longer paper/canary phase.** Lets more
   candidates through the walk-forward gate but leans harder on the downstream paper → canary gates
   (`strategies/_template/GATES.md` already requires ≥14 days paper, ≥50% of walk-forward edge
   realized, 100% replay match, and human approval before canary) to catch what DSR alone misses.

This packet's research also surfaces a reason to be cautious about *any* single-number threshold
in isolation: `llm-trading-eval-research.md` §4 (this session's scratchpad) documents a directly
analogous case — a paper claiming a calibration technique added +9.2 percentage points/year of
return dropped to a non-significant +1.17pp/yr once walk-forward validation and multiple-comparison
correction were applied, and only 3 of 9 tested models survived Holm correction at all. The lesson
carried into this repository's own design: `ml/validation/walkforward.py` already requires the
DSR to use the registry's true cumulative trial count (not a per-run count), which is the specific
protection against that failure mode — a threshold decision should not be made without also
confirming trial counting stays wired that way as strategies accumulate.

## Recommendation

Adopt the conventional **DSR ≥ 0.95**, keeping `strategies/_template/GATES.md`'s existing
walk-forward → paper gate's other thresholds (PBO ≤ 0.20, ≥70% positive out-of-sample folds, max
drawdown ≤ 1.5× backtest) unchanged, since none of those are the subject of this issue. 0.95 is the
threshold this repository's own code already cites the source paper for, and it is what a
reasonable reviewer would expect without further justification. The alternative worth naming
explicitly: if the founders want a materially different risk posture for the *first* strategy to
reach canary specifically, a stricter number (option 2) for that first promotion only, reverting to
0.95 afterward, is a defensible one-time exception — but that is a product choice, not a
statistical one, and should be recorded as such if chosen.

## Files that would change if this is accepted (not changed by this packet)

- `ml/validation/walkforward.py` line 45 — `GATE_DSR` would move from the literal `1.0` to a value
  read from a config file (per issue #22's own acceptance criteria: "the gate reads that number
  from a config file, not a number buried in code"). No such config file exists yet; this packet
  does not create one.
- `strategies/_template/GATES.md` — the walk-forward → paper row's "≥ 1.0, unreachable in practice;
  threshold pending a human decision" text would be replaced with the adopted number and its
  reasoning.
- `docs/adr/0013-learning-speeds.md` — the natural place to record the threshold and the
  walk-forward fold count/embargo window it's measured over, per issue #22's acceptance criteria.
- `ml/tests/test_walkforward.py` — already exists; would gain (or update) an assertion that the
  gate rejects a challenger below the threshold and accepts one above it on a fixture with a known
  DSR, per issue #22's acceptance criteria.

## Recommendation summary

Adopt DSR ≥ 0.95, the literature convention this repository's own DSR implementation already cites
Bailey & López de Prado (2014) for.

---

# DSR threshold sign-off (#22)

Related issue: #22

Decision: <what was actually decided, in plain language -- the exact threshold and the
fold/embargo parameters it's measured over, not "looks good">

Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
