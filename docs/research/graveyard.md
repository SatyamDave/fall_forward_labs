# Research graveyard

Ideas that were tried and failed, so they are not retried blindly. Check here before proposing research. Each entry links to its registry trials; add an entry whenever a walk-forward or gate fails.

| Date | Idea | Strategy or model | Gate reached | Why it failed | Registry link | Revisit only if |
|------|------|-------------------|--------------|---------------|---------------|-----------------|
| 2026-09-27 | Favorite-longshot bias on settled Kalshi binaries (prices <= 0.15 and >= 0.85, 24 h before expected expiry) | Study 0001, market-implied price vs one-parameter logit recalibration | Data capture (not reached: no sample) | Not tested. The registered listing rule (12 pages of 1000 per settlement day, drop a day that hits the cap) dropped every day: each of 40 days from 2026-08-01 had more than 12,000 settled non-combo markets. INSUFFICIENT EVIDENCE; the idea itself is neither supported nor refuted | `research/registry/log/trials.jsonl`, config sha256 `f13717f3...6a82a91`; `research/studies/0001-favorite-longshot/` | A new registration (new trial) that bounds the population before listing, e.g. by series or category, keeps raw pages of dropped slices, and is sized to the remaining request budget |
