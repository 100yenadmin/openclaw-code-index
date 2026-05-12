# OpenClaw Code Index

OpenClaw Code Index is a portable Codex Desktop and Codex CLI integration for
maintainers working on `openclaw/openclaw`. It is built on GitNexus and ships as
part of the public `100yenadmin/openclaw-code-index` fork of
`abhigyanpatwari/GitNexus`.

## Install From A GitHub Release Bundle

1. Download `openclaw-code-index-codex-plugin.zip` from the latest release.
2. Extract it anywhere on your machine.
3. Run the installer from the extracted directory:

   ```bash
   node install.mjs
   ```

4. Point Codex Desktop at the printed `codex-plugin/` path.
5. Add GitNexus MCP to Codex CLI if desired:

   ```bash
   codex mcp add openclaw-code-index -- node ~/.openclaw-code-index/installed/bin/openclaw-code-index.mjs mcp
   ```

The installer stages a portable copy under `~/.openclaw-code-index/installed`
and rewrites the SessionStart hook to use absolute paths, so the plugin keeps
working no matter where the downloaded zip was extracted.

## Install From The Fork

Clone the public fork and run:

```bash
cd openclaw-code-index/openclaw-code-index
node install.mjs
```

Then point Codex Desktop at:

```text
~/.openclaw-code-index/installed/codex-plugin
```

## Index OpenClaw

The default target is the latest OpenClaw GitHub release:

```bash
openclaw-code-index index --source latest-release
```

Other supported sources:

```bash
openclaw-code-index index --source latest-beta
openclaw-code-index index --source main
openclaw-code-index index --source ref --ref v2026.5.10
openclaw-code-index index --source local --path /path/to/openclaw
```

Indexes are local. The tool clones/fetches OpenClaw directly from
`openclaw/openclaw` into `~/.openclaw-code-index/repos/` and then runs
GitNexus analyze with the stable alias for that source. Set `GITNEXUS_BIN` to a
specific GitNexus binary when you want to pin the forked CLI; otherwise the
wrapper uses the first `gitnexus` on `PATH`.

Full OpenClaw graph indexing is CPU and disk work on your machine. It does not
spend model tokens unless you explicitly enable an embedding or LLM-backed
GitNexus workflow. On a maintainer laptop, the initial latest-release or `main`
index can take roughly 20-45 minutes. The wrapper allows 90 minutes by default;
set `OPENCLAW_CODE_INDEX_ANALYZE_TIMEOUT_MS` to override that for slower hosts.

`main` is intentionally manual. Automated refreshes are for release and beta
tags only, so local machines do not churn on every upstream `main` movement.

## Autoupdate

Install a local scheduled refresh for release or beta tags:

```bash
openclaw-code-index install-autoupdate --source latest-release --schedule daily
openclaw-code-index install-autoupdate --source latest-beta --schedule daily
```

Remove it:

```bash
openclaw-code-index uninstall-autoupdate
```

macOS uses a user LaunchAgent. Linux uses a user systemd timer when available
and falls back to crontab otherwise. Autoupdate does not support `main`; use
manual `index --source main` only when you explicitly want a moving-branch
index.

## Agent Contract

- Use GitNexus query/context/impact first for OpenClaw architecture, navigation,
  review, and shared-runtime edits.
- Verify graph answers with source reads.
- Treat stale indexes as hints, not proof.
- Do not expose GitNexus mutation/refactor tools in v1. The wrapper MCP hides
  mutation surfaces such as `rename` and `group_sync`.

## Bounded Context Slices

The plugin does not inject a generic 10k-token mini-index into every session.
Agents should retrieve task-scoped context when needed:

```bash
openclaw-code-index prime --query "provider auth routing" --tokens 8000
openclaw-code-index prime --symbol buildAgentRuntimeAuthPlan --tokens 5000
openclaw-code-index prime --impact buildAgentRuntimeAuthPlan --tokens 10000
```

The OpenClaw MCP also accepts `maxTokens` on `query`, `context`, and `impact`.
