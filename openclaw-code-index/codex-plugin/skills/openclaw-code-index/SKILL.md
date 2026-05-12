---
name: openclaw-code-index
description: Use when working in OpenClaw checkouts or worktrees and the task needs codebase orientation, execution-flow tracing, symbol context, blast-radius analysis, or safer review before editing shared OpenClaw runtime/plugin surfaces.
---

# OpenClaw Code Index

Use this skill for upstream `openclaw/openclaw` work in Codex Desktop.

## Contract

- Prefer GitNexus for OpenClaw architecture and navigation questions before broad `rg` sweeps.
- Use file reads to verify graph results before making maintainer-facing claims.
- Treat stale GitNexus indexes as non-authoritative.
- Run impact analysis before editing shared runtime, gateway, plugin SDK, provider/auth, Codex harness, sessions, prompt, memory, or compaction surfaces.
- Do not use GitNexus mutation/refactor tools in v1. This integration is read-only.

## Setup Checks

```bash
openclaw-code-index status --cwd <openclaw-checkout>
openclaw-code-index bootstrap --cwd <openclaw-checkout>
```

If no index exists, build one:

```bash
openclaw-code-index index --source latest-release
```

Use `--source main`, `--source ref --ref <tag-or-sha>`, or `--source local --path <path>` when the task needs a different OpenClaw target.

## GitNexus Workflow

- For unfamiliar areas: use MCP `query` with `repo: "openclaw-latest-release"` unless a different OpenClaw alias is required.
- For a symbol: use MCP `context` with the OpenClaw repo alias.
- Before modifying a symbol: use MCP `impact` with `direction: "upstream"`.
- Use `maxTokens` on `query`, `context`, or `impact` when you need a bounded slice.
- From a terminal, use `openclaw-code-index prime --query|--symbol|--impact ... --tokens <n>` for task-scoped context.
- For process traces: use GitNexus MCP resources for indexed processes.

## High-Blast-Radius Areas

Always impact-check and verify with source reads before editing:

- gateway/session state and `sessions.patch`
- plugin SDK entrypoints, hook contracts, and tool registration
- provider/auth resolution and credential/profile routing
- Codex harness, app-server, run-attempt, and thread lifecycle code
- prompt assembly, compaction, memory/context-engine integration
- generated API baselines or docs that reviewers depend on

## Reporting

When GitNexus informed a conclusion, state:

- which query/context/impact was used
- whether the index was fresh enough for the claim
- which source files verified the graph result
- any direct callers or affected process groups that matter to the edit
