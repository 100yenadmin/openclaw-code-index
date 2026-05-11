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
