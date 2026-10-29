<div align="center">
  <img src="dotfiles.svg" alt="dotfiles logo" width="400">
</div>

## New Mac setup

Clone this repository to `~/dotfiles`, then run:

```sh
./scripts/setup.sh
```

The script installs the Homebrew bundle, Herdr through its official installer, Node 24, pi, Zap, and links the managed Vim, Zsh, Git, Ghostty, Herdr, Hunk, Zed, and pi configuration. Existing files at managed locations are backed up before being replaced.

Zed installs the Aura theme and Charmed Icons extensions automatically and uses its bundled Zed Mono font. Machine-specific shell secrets belong in `zsh/secrets.zsh`, which is intentionally ignored by Git.

## Background Homebrew updates

Setup installs a macOS LaunchAgent that runs `brew update` and `brew upgrade --greedy` every two hours while logged in. This updates Homebrew, formulae, and casks, including auto-updating and `latest` casks. Pinned packages remain pinned. No terminal window or Dock icon is opened, but running processes remain visible in Activity Monitor.

To install or reload the schedule without running the full setup:

```sh
./homebrew/install-auto-update.sh
```

The first run is after two hours, not immediately. The job does not wake the laptop; a missed interval runs after waking. Updates requiring administrator access fail without prompting. Upgrading casks may affect running apps.

The latest run's output is saved to `~/Library/Logs/homebrew-autoupdate.log`. To stop updates:

```sh
launchctl bootout "gui/$(id -u)/com.timlolkema.homebrew-autoupdate"
rm ~/Library/LaunchAgents/com.timlolkema.homebrew-autoupdate.plist
```

## Sub-agents in pi

`@jerryan/pi-subagent-lite` provides one `subagent` tool for all agent roles. `pi/AGENTS.md` defines role mapping and delegated skill instructions.

## Project MCP servers from agents.toml

`pi/extensions/agents-mcp` loads `[[mcp]]` entries from trusted projects' `agents.toml` files. Parent sessions and subagents share the configuration without generating files. Credentials remain outside Git.

## Fastmail in pi

The setup links `pi/mcp.json` and `pi/AGENTS.md` into `~/.pi/agent/`, making Fastmail available for email requests in every project. Sign in using OAuth:

```sh
pi mcp login fastmail
pi mcp list
```

Approve read-only access for email search and summaries. OAuth credentials stay in `~/.pi/agent/mcp-auth.json`, outside this repository.
