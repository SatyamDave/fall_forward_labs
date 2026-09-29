#!/usr/bin/env bash
# Pluggable secret loading hook for the live host (#63). Source this from the systemd unit
# (or a shell) before starting ops/live/supervisor.py: `source ops/live/bin/load-secrets.sh`.
#
# QC_SECRETS_PROVIDER selects how ANTHROPIC_API_KEY and QC_ROBINHOOD_ACCOUNT_NUMBER get into the
# environment. Robinhood has no
# static token: its OAuth sign-in is a file (QC_ROBINHOOD_TOKEN_PATH, see ops/live/README.md). Never edit this file to hardcode a secret value; it only decides *how* they get
# read, never *what* they are.
set -euo pipefail

provider="${QC_SECRETS_PROVIDER:-env}"

case "$provider" in
  env)
    # Default and only implemented provider: the values are already in the environment
    # (systemd EnvironmentFile=, or however the shell that sources this got them). Nothing to do
    # -- this is the "implement env-based with a clear hook" option from issue #63.
    ;;
  1password)
    echo "load-secrets.sh: QC_SECRETS_PROVIDER=1password is documented, not implemented in this build." >&2
    echo "See ops/live/README.md's Secrets section for the 'op read'/'op run' shape." >&2
    exit 1
    ;;
  aws-secrets-manager)
    echo "load-secrets.sh: QC_SECRETS_PROVIDER=aws-secrets-manager is documented, not implemented in this build." >&2
    echo "See ops/live/README.md's Secrets section for the 'aws secretsmanager get-secret-value' shape." >&2
    exit 1
    ;;
  keychain)
    # macOS Keychain (issue #63). Secrets stored by ops/live/bin/setup-keychain.sh under
    # account "quant-live", service "quant-core-<VAR>". Only applicable on macOS.
    if ! command -v security &>/dev/null; then
      echo "load-secrets.sh: QC_SECRETS_PROVIDER=keychain requires macOS 'security' command." >&2
      exit 1
    fi
    _kc_read() {
      local var="$1"
      local val
      val=$(security find-generic-password -a "quant-live" -s "quant-core-${var}" -w 2>/dev/null) || {
        echo "load-secrets.sh: keychain: '${var}' not found -- run 'just secrets-setup' first." >&2
        exit 1
      }
      if [[ -z "$val" ]]; then
        echo "load-secrets.sh: keychain: '${var}' is empty -- run 'just secrets-setup' to re-enter it." >&2
        exit 1
      fi
      export "${var}=${val}"
    }
    _kc_read QC_ROBINHOOD_ACCOUNT_NUMBER
    _kc_read OPENROUTER_API_KEY
    # ANTHROPIC_API_KEY is optional at canary (QC_AGENT_MODE=openrouter never reads it),
    # but preflight checks its presence. Skip silently if not stored.
    _kc_optional=$(security find-generic-password -a "quant-live" -s "quant-core-ANTHROPIC_API_KEY" -w 2>/dev/null) \
      && export "ANTHROPIC_API_KEY=${_kc_optional}" || true
    unset _kc_optional
    ;;
  *)
    echo "load-secrets.sh: unknown QC_SECRETS_PROVIDER '$provider'" >&2
    exit 1
    ;;
esac
