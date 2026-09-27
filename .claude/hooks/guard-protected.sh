#!/usr/bin/env bash
# PreToolUse (Edit|Write): block edits to protected zones (root CLAUDE.md rule 3).
# QC_ALLOW_PROTECTED=1 in the environment Claude Code was launched with unlocks them,
# except that a change loosening a numeric limit in config/limits/*.toml stays blocked (rule 4).
# Exit 2 blocks the tool call. Anything this hook cannot evaluate is blocked, not allowed.
set -uo pipefail

code=$(cat <<'PY'
import fnmatch, json, os, re, subprocess, sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

PROTECTED = [
    "engine/crates/risk/**",
    "config/limits/**",
    "ops/deploy/**",
    "fund/**",
    ".github/workflows/**",
    ".github/CODEOWNERS",
    ".claude/hooks/**",
    ".claude/settings.json",
    "autonomy/**",
    "tests/autonomy/**",
    "tests/hooks/**",
]
# Keys where a larger value is a looser limit. min_* is the reverse. Any other numeric key
# has no known direction, so any change to it is treated as loosening.
LARGER_IS_LOOSER = re.compile(r"^(max_\w+|price_band_bps|stale_data_ms)$")
SMALLER_IS_LOOSER = re.compile(r"^min_\w+$")


def block(msg):
    print(f"Blocked by guard-protected: {msg}", file=sys.stderr)
    sys.exit(2)


try:
    data = json.load(sys.stdin)
except ValueError:
    block("could not parse hook input.")

tool = data.get("tool_name", "")
tin = data.get("tool_input") or {}
file_path = Path(tin.get("file_path", "").replace("\\", "/"))
if not file_path.is_absolute():
    file_path = Path(data.get("cwd") or os.getcwd()) / file_path


def repo_root(path):
    probe = path.parent
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        out = subprocess.run(
            ["git", "-C", str(probe), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            return Path(out.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd())


root = repo_root(file_path)
try:
    rel = file_path.resolve().relative_to(root.resolve()).as_posix()
except ValueError:
    sys.exit(0)  # outside the repository: not a protected zone

zone = next((z for z in PROTECTED if rel == z or fnmatch.fnmatch(rel, z)), None)
if zone is None:
    sys.exit(0)

if os.environ.get("QC_ALLOW_PROTECTED") != "1":
    block(
        f"{rel} is in protected zone {zone}. Protected zones are human-approved only. "
        "Propose the change in the PR description instead, or ask the human to restart "
        "the session with QC_ALLOW_PROTECTED=1."
    )

if not (rel.startswith("config/limits/") and rel.endswith(".toml")):
    sys.exit(0)

import tomllib  # stdlib since 3.11

old_text = file_path.read_text() if file_path.exists() else ""
if tool == "Write":
    new_text = tin.get("content", "")
elif tool == "Edit":
    old_s, new_s = tin.get("old_string", ""), tin.get("new_string", "")
    if not old_s or old_s not in old_text:
        block(f"cannot compute the new contents of {rel} (old_string not found), so the limit check cannot run.")
    new_text = old_text.replace(old_s, new_s) if tin.get("replace_all") else old_text.replace(old_s, new_s, 1)
else:
    block(f"unexpected tool {tool} on {rel}.")


def numeric_leaves(text, label):
    try:
        doc = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        block(f"{label} contents of {rel} are not valid TOML ({e}); the limit check cannot run.")
    out = {}
    def walk(node, prefix):
        for k, v in node.items():
            key = f"{prefix}{k}"
            if isinstance(v, dict):
                walk(v, key + ".")
            elif isinstance(v, bool):
                continue
            elif isinstance(v, (int, float)):
                out[key] = Decimal(str(v))
            elif isinstance(v, str):
                try:
                    out[key] = Decimal(v)
                except InvalidOperation:
                    pass
    walk(doc, "")
    return out


old_vals = numeric_leaves(old_text, "current")
new_vals = numeric_leaves(new_text, "proposed")

loosened = []
for key, old in old_vals.items():
    leaf = key.rsplit(".", 1)[-1]
    new = new_vals.get(key)
    if new is None:
        loosened.append(f"{key} removed (was {old})")
    elif LARGER_IS_LOOSER.match(leaf):
        if new > old:
            loosened.append(f"{key} raised {old} -> {new}")
    elif SMALLER_IS_LOOSER.match(leaf):
        if new < old:
            loosened.append(f"{key} lowered {old} -> {new}")
    elif new != old:
        loosened.append(f"{key} changed {old} -> {new} (no known tightening direction for this key)")

if loosened:
    block(
        "this change loosens risk limits in " + rel + ": " + "; ".join(loosened) + ". "
        "Rule 4: limits are only tightened automatically; loosening needs two human approvals, "
        "even with QC_ALLOW_PROTECTED=1."
    )
sys.exit(0)
PY
)

exec python3 -c "$code"
