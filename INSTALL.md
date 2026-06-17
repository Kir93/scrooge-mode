# Install

English · [한국어](INSTALL.ko.md)

Scrooge ships through three paths: Claude Code plugin, skills ecosystem, and the multi-agent installer. Pick one path; the installer is the broadest default.

## Prerequisites

- Node.js 18 or newer.
- Git access to `github.com/Kir93/scrooge-mode`.
- Target agent installed: Claude Code for the plugin path, Codex or another `skills`-supported agent for the skills path.
- Run one-line installer commands from your home directory (`cd ~`) unless you want `skills` CLI project-scope files in the current repo.

## Claude Code Plugin Path

Use this when you only need Claude Code integration.

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

Verify:

```bash
claude plugin list
```

Then start a Claude Code session and run:

```text
/scrooge ko full
```

Uninstall:

```bash
claude plugin uninstall scrooge@scrooge
```

If the statusline was installed by the one-line installer, run the project uninstaller too.

## Codex Skills Ecosystem Path

Use this when you want the skill through the `skills` ecosystem, especially for Codex and other supported agents.

List available skills:

```bash
npx skills add Kir93/scrooge-mode --list
```

Install for Codex:

```bash
npx skills add Kir93/scrooge-mode -a codex --yes --all
```

Install for another supported profile by replacing `codex` with the target profile, such as `cursor`, `windsurf`, `cline`, `continue`, or `gemini-cli`.

Verify:

```bash
npx skills add Kir93/scrooge-mode --list
```

Uninstall depends on the target agent's `skills` manager layout. Remove the installed `scrooge` skill from that agent's skill manager or skills directory. If Codex was installed through the one-line installer, also run the project uninstaller to remove the Codex hook payload.

## One-Line Installer

Recommended for most users. It detects Claude Code, Codex, Cursor, Windsurf, Cline, Continue, and Gemini CLI, then installs the matching integration.

```bash
npx -y github:Kir93/scrooge-mode
```

macOS / Linux shell alternative:

```bash
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash
```

Windows PowerShell alternative:

```powershell
irm https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.ps1 | iex
```

Useful flags:

```bash
npx -y github:Kir93/scrooge-mode -- --dry-run
npx -y github:Kir93/scrooge-mode -- --only claude
```

Pin a released version (reproducible installs — swap the tag for the release you want):

```bash
# curl|bash / npx — pins directly via the npm git-ref (guaranteed)
npx -y github:Kir93/scrooge-mode#v0.6.1

# forward the tag to the marketplace / skills channels the installer drives
npx -y github:Kir93/scrooge-mode#v0.6.1 -- --tag v0.6.1
```

| Channel | Tag pinning |
| ------- | ----------- |
| `npx -y github:<repo>#<tag>` | ✅ guaranteed (npm git-ref) |
| `--tag <ref>` → `claude plugin marketplace add` | best-effort — applied if your `claude` CLI resolves git refs |
| `--tag <ref>` → `npx skills add` | best-effort — applied if the `skills` CLI resolves git refs |

Without a tag every channel tracks `main`.

Uninstall:

```bash
npx -y github:Kir93/scrooge-mode -- --uninstall
```

From a local clone:

```bash
./uninstall.sh
```

Windows PowerShell:

```powershell
./uninstall.ps1
```

## Verify

After install, start the target agent and activate Scrooge:

```text
/scrooge ko full
```

On the Claude Code hook, plain language also activates — "talk like scrooge" / "스크루지처럼 답해줘" turns it on, "stop scrooge" / "스크루지 꺼" clears.

Expected behavior:

- The command activates `ko/full`.
- Follow-up replies use compressed Korean register until `/scrooge off`.
- Code blocks, error strings, and technical identifiers stay verbatim.
- Security warnings and irreversible-action confirmations return to normal prose.

Repository-side release verification:

```bash
npm test
npx markdownlint-cli2 "**/*.md"
node -e "JSON.parse(require('fs').readFileSync('registry.json'))"
```

## Troubleshooting

### Node Version Too Old

If the installer reports that Node is missing or too old, install Node.js 18 or newer and rerun the command.

```bash
node --version
```

### Claude CLI Missing

The Claude Code plugin path requires `claude` on `PATH`.

```bash
command -v claude
```

If this fails, install Claude Code first or use the `skills` ecosystem path for another agent.

### Project-Scope Skills Files Appear

Scrooge always installs skills at user (global) scope, so `.agents/`, `skills/<name>`, or `skills-lock.json` should never appear in a project. If you find leftovers from an older version, clean up by running the skills CLI removal for each installed agent (e.g. `npx -y skills remove Kir93/scrooge-mode -a codex`) and deleting any remaining `.agents/` or `skills-lock.json` from the project root.

### Permission Errors

If a shell script cannot execute, run:

```bash
chmod +x install.sh uninstall.sh
```

If a config file cannot be written, check ownership of `~/.claude` or `~/.codex` before rerunning.

## Uninstall

Use the same channel you installed with.

Claude Code plugin:

```bash
claude plugin uninstall scrooge@scrooge
```

One-line installer:

```bash
npx -y github:Kir93/scrooge-mode -- --uninstall
```

Local clone:

```bash
./uninstall.sh
```

Windows PowerShell:

```powershell
./uninstall.ps1
```

For `skills` CLI installs, remove the `scrooge` skill through the target agent's skill manager or skills directory. The project uninstaller removes Claude plugin/statusline wiring and Codex hook payloads; it does not own every third-party skills manager's storage.
