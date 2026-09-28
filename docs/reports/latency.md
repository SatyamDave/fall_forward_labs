# Latency: how fast one trading decision really is

Measured 2026-09-28, commit `729c592628fefb2c5b62f45b158348f5a8c07b07` (worktree had other
in-progress lane changes at capture time — see Environment below). Issues
[#31](https://github.com/SatyamDave/fall_forward_labs/issues/31) ("know how fast one trading
decision really is") and [#55](https://github.com/SatyamDave/fall_forward_labs/issues/55) ("say
honestly how fast we can trade"). Tool: `scripts/bench/latency.py` (`just bench-latency`).

**Headline: this is not HFT, and nothing about this PR makes it HFT.** Our own plumbing (bridge
IPC, book/feature/risk work, the TS agent's schema validation and decision logic) runs in
**fractions of a millisecond**. That is irrelevant to the achievable trading cadence, because the
one component this report cannot measure — a real Anthropic API call in `QC_AGENT_MODE=live` — is
**three to four orders of magnitude slower** than everything we do measure, per the UNVERIFIED
third-party estimates in `agent-sdk-research.md` §6 (no live call is made anywhere in this repo;
root `CLAUDE.md` rule 2 and the hard limits on this build forbid it). The bottleneck is, and will
remain, **the model's own response time**, not our engine, our IPC, or our code.

## What was measured, and how

Three components of the ADR-0040 loop (`qc-bridge` → agent service → `qc-bridge`), using the
**real** `qc-bridge` release binary and the **real** agent-side TypeScript
(`agent/src/bridge.ts`'s `BridgeClient`, `agent/src/decider/{fake,replay}.ts`,
`agent/src/loop.ts`'s `runLoop`) — `scripts/bench/decide-bench.mts` imports these modules
unmodified and wraps them in timing proxies; it does not re-implement the loop, and this PR does
not edit `agent/src/` or `engine/crates/bridge/`.

1. **Raw bridge round trip** — a plain Python JSON-Lines client (`scripts/bench/latency.py`)
   talking directly to `qc-bridge`'s stdin/stdout, calling `next_decision_request` with no TS
   layer at all. This isolates the bridge/engine's own IPC, book, feature and risk-context-build
   overhead from anything Node- or TypeScript-specific.
2. **Agent decide step** — the decider's `decide()` call alone, timed with no IPC around it: fake
   mode (`FakeDecider`, the deterministic rule CI runs) and replay mode (`ReplayDecider`, exact
   playback of a previously recorded trajectory).
3. **Full loop** — `next_decision_request` → `decide()` → `submit_order_intent`/`no_trade`, timed
   exactly as `runLoop` runs it (per-decision, summed post-hoc from the three timed sub-steps so
   it reflects what actually happened on that iteration, not a separate re-run).

Fake and replay use the **same** 1,000 decisions: a fake-mode pass captures each
`DecisionRequest`/`Decision` pair as a `decision_ledger_entry`-shaped fixture
(`out/bench/replay-fixtures/`, gitignored), then a second, identically-configured `qc-bridge`
process (same recording, limits, model, `--decide-every`) replays it — `qc-bridge` is deterministic
(root `CLAUDE.md` rule 7), so the same `DecisionRequest` sequence recurs byte-for-byte, which is
exactly what `ReplayDecider`'s exact-match check requires. No live Anthropic call is made in either
pass; `QC_AGENT_MODE=live` is out of scope for this measurement (no API key on this build; see
"Live-mode estimate" below).

Fixture: `tests/replay/sample_day.csv` (5,001 records) with `--decide-every 1`, which yields ~4,200
decision opportunities — comfortably above the 1,000 this run requested. `--decide-every 1` is a
bench-only setting to get volume from one fixture; it is not a proposed trading cadence.

## Results (N = 1,000 decisions per component)

| Component | mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | throughput (decisions/s) |
|---|--:|--:|--:|--:|--:|--:|
| Raw bridge round trip | 0.015 | 0.008 | 0.016 | 0.025 | 5.289 | 68,095 |
| Fake — bridge request (`next_decision_request`, via TS `BridgeClient`) | 0.071 | 0.026 | 0.064 | 0.163 | 37.681 | 14,044 |
| Fake — decide (`FakeDecider`) | 0.001 | 0.000 | 0.002 | 0.006 | 0.241 | 1,006,409 |
| Fake — bridge submit (`submit_order_intent`/`no_trade`) | 0.027 | 0.019 | 0.048 | 0.120 | 2.085 | 37,077 |
| **Fake — full loop** | **0.099** | **0.047** | **0.115** | **0.280** | **38.311** | **10,084** |
| Replay — bridge request | 0.034 | 0.023 | 0.039 | 0.064 | 7.514 | 29,189 |
| Replay — decide (`ReplayDecider`) | 0.002 | 0.001 | 0.003 | 0.005 | 0.030 | 577,635 |
| Replay — bridge submit | 0.017 | 0.014 | 0.026 | 0.046 | 0.278 | 60,363 |
| **Replay — full loop** | **0.053** | **0.039** | **0.066** | **0.122** | **7.818** | **19,027** |

Full JSON (all fields, both runs' raw numbers): `out/bench/latency-results.json` (gitignored;
regenerate with `just bench-latency`).

### Reading the two "bridge request" rows

The raw round trip (0.008 ms p50) and the TS `BridgeClient`'s `next_decision_request` (0.026 ms
fake / 0.023 ms replay p50) measure the same bridge operation two different ways. The ~3x gap
between them **is** "our own plumbing" that issue #31 asks to separate out: `randomUUID()`,
JSON stringify/parse, ajv schema validation against `schemas/decision/v1/*.schema.json`, and
Node's event loop/Promise scheduling around the child-process pipe. It is real, but at
tens-of-microseconds scale it is noise next to anything model-shaped.

### Environment

| | |
|---|---|
| Captured | 2026-09-28T19:33:46Z |
| OS | Darwin 27.2.0 (macOS) |
| Machine / CPU | arm64, Apple M5 Pro, 18 logical CPUs |
| Python | 3.14.6 (system `python3`; the bench script has no dependency on `research/`'s uv venv) |
| Node | v26.4.0 |
| rustc | 1.97.1 (8bab26f4f, 2026-07-14) |
| Git commit | `729c592628fefb2c5b62f45b158348f5a8c07b07` (wave2/latency worktree; other lanes' uncommitted work was present in sibling worktrees, not this one) |

Recorded automatically by `scripts/bench/latency.py`'s `environment_info()` on every run; the
`environment` block in the JSON output is authoritative for any given run, not this table — numbers
above are one snapshot on one machine, not a cross-machine guarantee.

## The honest "first HFAT" definition (issue #55)

The owner's original framing asked to define a "first HFAT" (high-frequency agentic trade). Per
this session's coordinator spec and `agent-sdk-research.md` §6, literal high-frequency trading
(microsecond-to-low-millisecond cadence) **is not achievable** with an LLM in the decision path,
full stop — no amount of optimizing our own engine, bridge, or agent-service code closes a gap
that is fundamentally about network round trips to a hosted model service. The measurements above
confirm the *non-bottleneck* side of that claim empirically: our own plumbing is not what would
limit cadence. What follows is the redefinition the spec asks for: **"first HFAT" = the highest
sustained decision rate the measured loop supports, bounded by the slowest real component in the
path** — which today is the LLM call we have not yet made.

**Definition adopted:** the highest sustained decision rate at which p99 end-to-end latency stays
well under the approval TTL (protocol v1.1: `expires_ts_ns` = decision timestamp + 5 s of market
time, `schemas/decision/v1/`) **and** within Robinhood's actual rate limits.

Applying it:

- **Our plumbing's contribution is negligible.** Fake-mode full-loop p99 is 0.28 ms; even the
  worst single observation across 1,000 decisions (max 38.3 ms, one cold-start outlier — see
  "Limitations") is under 40 ms. Against a 5-second TTL, our own code could sustain decisions at
  roughly 3,500/s before *our* p99 alone would matter, which is nowhere close to being the limit.
- **The LLM call is the limit, by three to four orders of magnitude.** Combining our measured
  plumbing overhead with the UNVERIFIED third-party estimate from `agent-sdk-research.md` §6
  (single-turn ≈1-5 s, multi-turn agentic exchange ≈5-15 s+, both for a prior Claude generation,
  not confirmed for the current one — see "Live-mode estimate" below): total decision latency in
  live mode would be **dominated entirely by the model call**, with our own plumbing adding well
  under 1% on top.
- **Against the 5-second approval TTL specifically:** a single-turn, schema-only decision
  (`outputFormat: json_schema`, no tool-use round trip) at the low end of the UNVERIFIED 1-5 s
  estimate leaves real but thin margin under a 5 s TTL. A multi-turn agentic exchange (propose →
  tool call → reconsider) at the UNVERIFIED 5-15 s+ estimate **would already exceed the 5 s TTL on
  its own**, before any network jitter — meaning multi-turn decisions are not viable within the
  current TTL design without either (a) keeping live-mode decisions single-turn/schema-only, or
  (b) a deliberate, reviewed TTL change (protected path, `schemas/decision/v1/`). This report does
  not recommend either option; it states the constraint the two measured/estimated numbers impose.
- **Robinhood's rate limits are UNVERIFIED (issue #27, tracked separately)** — this report cannot
  bound "first HFAT" against them yet, and says so rather than guessing. Once #27 resolves, the
  achievable cadence is `min(TTL-bound cadence above, Robinhood's real per-minute/per-day limit)`.

**Adopted statement for the roadmap:** *"First HFAT" is one decision every roughly 1-5 seconds at
best (single-turn, live mode, UNVERIFIED third-party estimate), never faster, because the model's
own response time — not our network, engine, or agent-service code — is the bottleneck. This
replaces any framing of "high-frequency" in the traditional trading sense.* Publishing this into
`docs/ROADMAP.md` with both founders' sign-off is the remaining step in issue #55 and is out of
this PR's path (`scripts/bench/**` and this doc only, per the wave-2 lane split); see "Scope" below.

## Live-mode estimate (UNVERIFIED, not measured here)

No live Anthropic API call is made anywhere in this repository (root `CLAUDE.md` rule 2; this
build's hard limits forbid it; `loop-agent-eval` ships disabled at zero budget per ADR-0040 §5).
The following is carried over from `agent-sdk-research.md` §6, itself sourced from third-party
benchmarks (Artificial Analysis, accessed 2026-09-27) for a prior Claude model generation, not
confirmed for the current one, and explicitly marked UNVERIFIED there:

| Scenario | Estimated latency | Source |
|---|---|---|
| Single-turn, schema-only decision (`outputFormat: json_schema`, no tool-use round trip) | ~1-5 s | UNVERIFIED, third-party, prior model generation |
| Multi-turn agentic exchange (propose → tool call → reconsider) | ~5-15 s+ | UNVERIFIED, third-party, prior model generation |

Estimated live-mode end-to-end latency = (the LLM time above) + (our measured plumbing overhead,
~0.05-0.1 ms full-loop p50 from this report) ≈ **the LLM time above, unchanged to three significant
figures.** Our plumbing does not move this number in any way that matters. When #31's live-mode
measurement (≥30 real decisions, per the issue's engineering notes) is authorized and run, replace
this section's estimate with a measured number — this is flagged here, not treated as settled.

## Limitations

- **No live-mode measurement.** This report only measures fake and replay mode. `agent-sdk-research.md`
  §6's live-mode figures are third-party and UNVERIFIED; issue #31's "at least 30 real decisions in
  live mode" acceptance criterion is not met by this PR and needs `ANTHROPIC_API_KEY` plus
  `scripts/ci/ai_gate.py loop-agent-eval` enabled with a real budget — neither is authorized here.
- **`--decide-every 1` is a bench setting, not a proposed cadence.** It exists purely to get 1,000+
  decisions out of one 5,001-record fixture; production cadence is a separate, unrelated decision.
- **Outliers (max column) are consistent with process/OS scheduling noise, not measured
  separately.** The fake-mode full-loop max (38.3 ms, decision #0) is the first decision after
  process spawn and Node module resolution; every later decision falls to sub-millisecond. This
  report does not separate "steady-state" from "cold-start" percentiles because the p50/p95/p99
  figures already exclude the outlier by construction (linear-interpolation percentiles over 1,000
  points), and the raw JSON keeps every individual observation if a future reader wants to.
- **Single machine, single run per component.** Numbers will vary by hardware; the environment
  block exists so a different run can be compared honestly rather than assumed equivalent.
- **Sequential throughput, not concurrent.** `throughput_per_sec = 1 / mean_latency`; this is what
  the current, single-in-flight-decision loop actually sustains, not a claim about what N parallel
  agents could do (see issue #54, out of scope here).

## Scope (wave-2 lane C)

This PR adds only `scripts/bench/**` and this doc, per the wave-2 coordinator spec's lane split; it
does not edit `agent/src/`, `engine/crates/bridge/`, or `docs/ROADMAP.md`. Issue #55's remaining
acceptance criteria — publishing the adopted cadence statement into `docs/ROADMAP.md` and getting
both founders' recorded acknowledgment — are a follow-up outside this PR's path grant.

## Reproduce

```
just agent-setup        # npm ci in agent/ (installs tsx, ajv, etc.), one-time
just bench-latency --n 1000
# or, reusing an already-built qc-bridge release binary:
just bench-latency --n 1000 --skip-build
python3 scripts/bench/test_latency.py -v   # percentile-math tests
```
