# OpenClaw Code Index v0.1.5

Hardens the Codex integration after duplicate-MCP and fresh-install stress
testing.

- Bundles the forked GitNexus CLI into the release zip and fails closed for MCP
  if the patched CLI is unavailable
- Filters OpenClaw read-only MCP aliases/resources to actual OpenClaw indexes
  and blocks group-mode repo routing
- Adds bounded defaults and upper limits for MCP/CLI retrieval slices, including
  `gitnexus impact --max-tokens`
- Prevents read-only MCP startup from repairing/quarantining LadybugDB WAL files
  as a side effect
- Clarifies agent guidance: GitNexus for architecture/flow/impact navigation,
  `rg` and file reads for exact verification
- Updates release and smoke workflows to build and use the forked GitNexus code,
  not upstream `gitnexus@latest`

# OpenClaw Code Index v0.1.4

Makes OpenClaw Code Index use the canonical forked GitNexus behavior instead of
plain upstream `gitnexus@latest`.

- Ports the carried Electric Sheep GitNexus fixes into the OpenClaw fork:
  token-budgeted query/context output, MCP alias normalization, eval-server auth,
  and hardening tests
- Adds `openclaw-code-index mcp`, a read-only wrapper that hides mutation tools
  such as `rename` and `group_sync`
- Adds `openclaw-code-index prime` for bounded task-scoped context slices
- Adds MCP `maxTokens` support for `query`, `context`, and `impact`
- Rewires the Codex Desktop plugin and Codex CLI instructions to use the
  OpenClaw wrapper MCP

# OpenClaw Code Index v0.1.3

Constrains automatic index refreshes to OpenClaw release and beta tags.

- Removes the scheduled hosted smoke index; it is manual only
- Removes `main` from local autoupdate support
- Adds `latest-beta` as an explicit release-channel source
- Keeps `main` available only through manual `index --source main`

# OpenClaw Code Index v0.1.2

Fixes unattended macOS autoupdate reliability.

- Adds a launchd `PATH` so scheduled refreshes can find Homebrew tools
- Uses the installed global `gitnexus` binary when available, avoiding `npx`
  startup during scheduled refreshes

# OpenClaw Code Index v0.1.1

Fixes the hosted OpenClaw smoke workflow timeout for clean GitHub runners.

- Raises the OpenClaw analyzer wrapper timeout to 90 minutes by default
- Gives the hosted smoke workflow 120 minutes per job
- Uses the installed `gitnexus` binary in CI smoke runs

# OpenClaw Code Index v0.1.0

Initial portable Codex distribution for OpenClaw maintainers.

- Codex Desktop plugin bundle
- Codex CLI MCP setup instructions
- OpenClaw latest-release/main/ref/local indexing helper
- Local autoupdate installer
- GitHub Actions for bundle release, upstream sync, and smoke checks
