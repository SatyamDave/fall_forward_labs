# Security policy

## Reporting a vulnerability

Do not open an issue, PR, discussion or chat message that describes the problem.

- While this repository is private, report directly and privately to the maintainer, @SatyamDave. Include what is affected, how to reproduce it, and what access it gives.
- If the repository becomes public, use GitHub private vulnerability reporting (Security tab, "Report a vulnerability"). `scripts/harden-repo.sh` turns it on; GitHub offers it for public repositories only.

Expect an acknowledgement within 2 working days. A report that touches venue keys or a live process is handled as an incident: halt first (kill switch), then investigate (`docs/postmortems/0000-template.md`).

## Secret handling

- No secrets in git, ever: not in code, config, tests, fixtures, notebooks, commit messages, issues or PRs. `.env` is for local development only and is gitignored.
- Production and paper secrets live in the secret manager (`ops/deploy/README.md`), scoped per strategy and per environment. Venue keys are trade-only, withdrawal-disabled and IP-allowlisted.
- Never read, print, log or echo a secret, and never paste one into a prompt.
- CI jobs that read PR or other external text do hold a credential: the model API key. The controls around it:
  - Fork PRs get no secrets. `ai-review` runs only for same-repo, non-draft PRs.
  - Every job that calls a paid model first asks the AI gate (`scripts/ci/ai_gate.py`, reading `autonomy/POLICY.yaml`), which ships switched off.
  - The jobs that hold `ANTHROPIC_API_KEY` are `ai-review` (`security-review` and `code-review`: the PR diff, title, body and code, with a `pull-requests: write` token to post comments) and the `propose` jobs of `knowledge-sync`, `gardener` and `learnings-triage` (merged PR diffs, bodies and comments, and the learnings inbox, with a read-only token).
  - None of these jobs gets venue, deploy or secret-manager credentials, or a token that can write code.
- Pre-commit (gitleaks, detect-private-key) and CI (trivy secret scan, semgrep `p/secrets`) look for secrets on every change.
- A leaked secret is rotated immediately, even if the commit never left a laptop. Removing it from history is not a substitute for rotation.

## Merge policy for findings

Scanners: cargo-deny, cargo-audit, pip-audit, bandit, osv-scanner, semgrep, trivy, checkov, CodeQL (when code scanning is available) and the AI reviewers.

| Severity | Rule |
|----------|------|
| Critical, High | The build fails. Fix or upgrade before merge. No ignore entries. |
| Medium | May merge only with (1) a justification comment at the suppression (`# nosec Bxxx: <reason>`, `# checkov:skip=<id>: <reason>`, a `deny.toml` ignore with `reason`) and (2) a linked tracking issue with an owner. |
| Low, Info | Fix when touching the code. |

A suppression without a reason is rejected in review. A tool that could not run is a failed check, not a pass. AI review comments are advisory; they never replace the deterministic gates or human review.

## Supported versions

Only `main` is supported. There are no released versions yet.
