#!/usr/bin/env bash
# Store quant-core live-trading secrets in macOS Keychain (issue #63).
# Run once per machine, or again to rotate a secret: just secrets-setup
#
# Secrets are stored under account "quant-live", service "quant-core-<VAR>".
# load-secrets.sh's keychain provider reads them back at startup; nothing
# else in this repo touches Keychain directly.
#
# Why Keychain and not a plain env file:
#   - Encrypted at rest by macOS, unlocked by your login password.
#   - Not readable by other users on the same machine.
#   - Never a plain-text file that can be accidentally committed or leaked.
set -euo pipefail

ACCOUNT="quant-live"

store() {
    local var="$1" label="$2" optional="${3:-}"
    echo ""
    if [[ -n "$optional" ]]; then
        printf "%s (press Enter to skip — not needed for OpenRouter canary): " "$label"
    else
        printf "%s: " "$label"
    fi
    read -rs value
    echo ""
    if [[ -z "$value" ]]; then
        if [[ -n "$optional" ]]; then
            echo "  skipped."
            return
        fi
        echo "  error: $var cannot be empty." >&2
        exit 1
    fi
    security add-generic-password \
        -a "$ACCOUNT" \
        -s "quant-core-${var}" \
        -w "$value" \
        -U 2>/dev/null
    echo "  stored in Keychain."
}

echo "quant-core secrets setup (macOS Keychain)"
echo "Input is hidden. Values are never echoed or logged."
echo "Run again at any time to rotate a secret."

store "QC_ROBINHOOD_ACCOUNT_NUMBER" \
    "Robinhood account number (e.g. ABC12345678)"

store "OPENROUTER_API_KEY" \
    "OpenRouter API key (from openrouter.ai/keys)"

store "ANTHROPIC_API_KEY" \
    "Anthropic API key (for future live-Claude mode)" \
    "optional"

echo ""
echo "Done. Run 'just preflight-live' to verify the setup."
