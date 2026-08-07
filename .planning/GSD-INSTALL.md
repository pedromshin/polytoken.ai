# GSD Core — install + reconciliation notes

_Installed 2026-07-24 from **open-gsd/gsd-core v1.8.0**; bumped 2026-08-07 to
**v1.9.1** across all four vendored subtrees (commit in
`.claude/gsd/SOURCE_COMMIT.txt`). This repo was already a GSD project — only the
plugin machinery had never been committed._

## What was installed (and where)

| Piece | Location | Tracked in git? |
|---|---|---|
| 71 `/gsd:*` slash commands | `.claude/commands/gsd/*.md` | yes (dir already tracked) |
| 34 `gsd-*` agents | `.claude/agents/gsd-*.md` | yes (via `.gitignore` negation) |
| 71 `gsd-*` skills | `.claude/skills/gsd-*/SKILL.md` | yes (via `.gitignore` negation) |
| Hook scripts + plugin manifest | `.claude/gsd/hooks/`, `.claude/gsd/.claude-plugin/` | yes |

**Why vendored into the repo instead of a real `/plugin install`:** this is an
ephemeral remote container with no persistent user-scope plugin store, so a
marketplace install would evaporate at session end. Committing the machinery is
the only way `/gsd:*` survives to the next session. This intentionally overrides
the repo's prior "keep the plugin uncommitted" convention (the old `.gitignore`
comment). To revert: drop the `!.claude/skills/gsd-*/` and `!.claude/agents/gsd-*.md`
negations and move the install into the environment's setup script instead.

## Reconciliation with the existing `.planning/`

The layout **already matches GSD Core** — no migration was required:
- `.planning/config.json` is a valid GSD config (`mode: yolo`, `model_profile: balanced`,
  `use_worktrees: false`, `max_concurrent_agents: 3`, `verifier: true`, `code_review: false`).
- `.planning/STATE.md` carries `gsd_state_version: 1.0`; `ROADMAP.md`, `REQUIREMENTS.md`,
  `PROJECT.md`, `RETROSPECTIVE.md`, `graphs/`, `milestones/`, `phases/` are all present and
  GSD-native.

**Divergences to be aware of (the repo added its own conventions on top of GSD):**
- **Two live-state files.** GSD's canonical live file is `STATE.md`; this repo also keeps a
  hand-maintained **`ORCHESTRATOR-STATE.md`** ledger (used by the unattended orchestrator runs).
  `STATE.md` is currently **behind reality** (last synced 2026-07-22 at v1.11, 1/6 phases; a lot
  has shipped since). The `/gsd:*` commands read `STATE.md`, so before driving GSD in earnest,
  run `/gsd:health` (diagnose) and sync `STATE.md` from `ORCHESTRATOR-STATE.md`, or fold the two.
- **Non-GSD dirs** the plugin won't touch but the team relies on: `assessment/`, `todos/`,
  `prompts/`, `night-run/`, `ui-reviews/`. These are safe to keep alongside GSD's own dirs.

## Hooks — vendored but NOT auto-wired (deliberate)

The hook scripts are present under `.claude/gsd/hooks/` but no `.claude/settings.json` hooks
block was written. Two reasons: (1) writing `.claude/settings.json` is blocked by the environment's
action classifier; (2) the two upstream `SessionStart` hooks are wrong for this container anyway —
`gsd-ensure-canonical-path.js` mutates the working tree and `gsd-check-update.js` hits the network
with no timeout. All the *tool* hooks fail open, and `gsd-worktree-path-guard.js` no-ops outside a
GSD-managed `agent-*` worktree, so they are safe to enable.

To turn the safe hooks on, add this to `.claude/settings.json` (skip the two SessionStart hooks):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit", "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/gsd/hooks/gsd-prompt-guard.js\"", "timeout": 5 },
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/gsd/hooks/gsd-read-guard.js\"", "timeout": 5 }
      ] },
      { "matcher": "Write|Edit|MultiEdit", "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/gsd/hooks/gsd-worktree-path-guard.js\"", "timeout": 5 }
      ] }
    ],
    "PostToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit|Agent|Task", "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/gsd/hooks/gsd-context-monitor.js\"", "timeout": 10 }
      ] },
      { "matcher": "Read|WebFetch|WebSearch", "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/gsd/hooks/gsd-read-injection-scanner.js\"", "timeout": 5 }
      ] }
    ]
  }
}
```

## ⚠️ Execution backend NOT installed — the skills are prompt-shells

What's vendored is the **prompt layer** (the `/gsd:*` commands, agents, and skills as markdown).
Several GSD workflows also call an **execution backend** that is NOT installed here:
- a `gsd-tools` CLI (e.g. `gsd-tools query validate.context`), and
- workflow libs the skills load by absolute path, e.g. `@~/.claude/gsd-core/workflows/<name>.md`.

Those ship in the npm package (`@opengsd/gsd-core`'s `bin/` + `gsd-core/` dirs), which the vendor
copy deliberately omits (they'd need a build + `~/.claude` install that doesn't persist in this
ephemeral container). Consequence: a command like `/gsd:health` loads but can't run its tool calls,
so it can't fully self-execute. The prompt-driven skills (plan/discuss/execute reasoning) still work;
only the tool-backed queries/validators are inert.

To get full execution, add this to the **environment setup script** (persists per session, unlike a
manual `~/.claude` copy): `npx -y @opengsd/gsd-core@latest` (installs the CLI + workflow libs to the
paths the skills expect). Until then, drive GSD by hand — which is what the 2026-07-24 state
reconciliation did (see `ORCHESTRATOR-STATE.md` ⭐ CURRENT block) in place of `/gsd:health`.

## Updating GSD later

Re-run the vendor: shallow-clone `open-gsd/gsd-core`, copy `commands/gsd`, `agents/gsd-*`,
`skills/gsd-*`, `hooks/`, `.claude-plugin/` over `.claude/`, refresh `SOURCE_COMMIT.txt`. Do NOT
run `/gsd:update` — it targets a real plugin install, which this is not.
