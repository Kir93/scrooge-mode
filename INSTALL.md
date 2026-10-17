# Install

English · [한국어](INSTALL.ko.md)

Scrooge ships through three paths: Claude Code plugin, skills ecosystem, and the multi-agent installer. Pick one path; the installer is the broadest default.

## Prerequisites

- Node.js 18 or newer.
- Git access to `github.com/Kir93/scrooge-mode`.
- Target agent installed: Claude Code for the plugin path, Codex or another `skills`-supported agent for the skills path.
- Run the one-line installer from any directory: it installs skills at user scope (`-g`), so no project-scope `skills` files land in the current repo.

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
claude plugin marketplace remove scrooge
```

If the statusline was installed by the one-line installer, run the project uninstaller too.

> **If you also run caveman, grill-me, or another output-compression register:**
> disable one. Both inject a style directive on every turn via the same
> `UserPromptSubmit` event and cannot see each other, so the model receives
> contradictory instructions (caveman issue #574). The one-line installer prints a
> warning when it detects one — **this plugin path never runs that installer, so it
> cannot warn you here.**

## Codex Skills Ecosystem Path

Use this when you want the skill through the `skills` ecosystem, especially for Codex and other supported agents.

List available skills:

```bash
npx skills add Kir93/scrooge-mode --list
```

Install for Codex:

```bash
npx skills add Kir93/scrooge-mode -a codex -g -y --skill '*'
```

Install for another supported profile by replacing `codex` with the target profile, such as `cursor`, `windsurf`, `cline`, `continue`, or `gemini-cli`.

Verify:

```bash
npx skills add Kir93/scrooge-mode --list
```

Uninstall depends on the target agent's `skills` manager layout. Remove the installed `scrooge` skill from that agent's skill manager or skills directory. If Codex was installed through the one-line installer, also run the project uninstaller to remove the Codex hook payload.

## One-Line Installer

Recommended for most users. It auto-detects Claude Code, Codex, Cursor, Windsurf, Cline, and Continue, then installs the matching integration.

```bash
npx -y github:Kir93/scrooge-mode
```

**Gemini CLI is opt-in, not auto-detected.** Its probe is best-effort, so the installer leaves it out of a plain run — name it to install it:

```bash
npx -y github:Kir93/scrooge-mode -- --only gemini
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
npx -y github:Kir93/scrooge-mode -- --config-dir ~/.claude-work   # Claude config dir for the plugin + statusline (default $CLAUDE_CONFIG_DIR, else ~/.claude)
```

`--config-dir` is also passed as `CLAUDE_CONFIG_DIR` to every `claude plugin` call, so the plugin lands in the same profile as the statusline.

Pin a released version (reproducible installs — swap the tag for the release you want):

```bash
# npx — pins directly via the npm git-ref (guaranteed; the curl|bash shim always installs main)
npx -y github:Kir93/scrooge-mode#vX.Y.Z

# forward the tag to the marketplace / skills channels the installer drives
npx -y github:Kir93/scrooge-mode#vX.Y.Z -- --tag vX.Y.Z
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

## Config File Safety

Installing and uninstalling edit two files you own:

| File | Touched by |
| ---- | ---------- |
| `<claude-config>/settings.json` (default `~/.claude/settings.json`) | statusline wiring on install, statusline removal on uninstall |
| `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) | Codex hook wiring on install, hook removal on uninstall |

Before the first edit to either file, the installer copies it to `<path>.bak`. That copy is written **once** — it is your pre-install snapshot, and no later install or uninstall overwrites it. Uninstall deliberately leaves the `.bak` in place; delete it yourself when you no longer want it.

Edits are written to a temp file in the same directory and then renamed over the target, so an interrupted write (crash, full disk, Ctrl-C) leaves the original intact rather than truncated. File permissions are preserved.

If one of those paths is a symlink — a dotfiles setup pointing `~/.claude/settings.json` at a tracked repo — the installer follows it and edits the real file, leaving the symlink in place. The `.bak` is then created next to the **real** file, not next to the link, so restore from that location.

To restore a file (if you installed with `--config-dir`, use that path for the first line):

```bash
mv "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json.bak" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
mv "${CODEX_HOME:-$HOME/.codex}/config.toml.bak" "${CODEX_HOME:-$HOME/.codex}/config.toml"
```

## Flags (lean on by default)

`lean` (minimal code output) is **on by default** — `/scrooge` trims over-engineering and narration, never correctness (its fragment pins the safety floor). Measured on top of `full`, paired against the same register without the flag: **KO +17.6%** (95% CI 10.2–43.7%) / **EN +18.1%** (95% CI 10.7–28.3%), est, prose-only, `claude-opus-4-8`, 8 prompts × 3 runs each. Reproduce with `python3 benchmarks/report.py --input results-lean2-{ko,en}.jsonl --baseline scrooge:{ko,en}/full --paired --drop-tool-rows`. These supersede the KO +34.6% / EN +10.3% pair published through v0.22.1 ([why](benchmarks/README.md#the-lean-flag-numbers)). To change the default:

- Per session: `/scrooge … nolean` (drop lean).
- Globally via your shell profile:

```bash
export SCROOGE_DEFAULT_FLAGS=lean       # lean on (the default)
export SCROOGE_DEFAULT_FLAGS=           # disable all flags
```

Only `lean` is honored; unknown tokens are ignored. (Activating with `/scrooge …` also saves a **global default** that auto-activates new sessions until `/scrooge off`.)

## Removed in v0.23.0: `memory-compress`

The optional `memory-compress` CLI (input-side compression of CLAUDE.md / AGENTS.md)
was removed. Its own measurements closed it: Phase 0 put the floor at 7.7%, the
follow-up context-audit measured a realizable live median of ~3–4%, and prompt
caching prices a cached prefix at roughly a tenth of the input rate — so
compressing one is worth close to nothing. Scrooge is an **output**-side register;
that is now the whole product. Ledger entries written by the old CLI are still
readable and are simply ignored.

## Update

Re-running the installer updates every detected agent in place — Scrooge is safe to re-run.

```bash
npx -y github:Kir93/scrooge-mode
```

On **Claude Code** the installer no longer skips an already-installed plugin. It refreshes the marketplace catalog and updates the plugin to the latest version:

```bash
claude plugin marketplace update scrooge
claude plugin update scrooge@scrooge
```

`claude plugin update` applies on the next Claude Code restart, so restart your session afterward.

After updating, the first new session shows a one-time reminder of how to re-activate — a version change can reset activation. Run `/scrooge ko full` once; the global default then keeps every later session active until `/scrooge off`. A session you explicitly turned off with `/scrooge off` (e.g. one you resume) gets no re-activation reminder — it is off by your choice, not the upgrade's.

For **Codex**, the re-run overwrites the hook payload (hooks, rules, lib, registry) and re-merges the `~/.codex/config.toml` hook idempotently — an `enabled = false` you set on the Scrooge trust entry stays disabled. The Codex hook keeps its state under the Codex dir (`$CODEX_HOME`, default `~/.codex` — the parent of the `scrooge` payload) and ignores an exported `CLAUDE_CONFIG_DIR`, so a Codex `/scrooge off` never clears Claude's global default. **Other skills agents** (Cursor, Windsurf, Cline, Continue, Gemini CLI) get their `scrooge` skill overwritten on re-run. Either way they pick up the latest automatically.

> **Codex tier limit.** The Codex integration wires only the `UserPromptSubmit` hook, not `SessionStart` — so the in-session update notice and the `↑vX` statusline marker never surface on Codex. Because the Codex payload is a copy (no in-place `plugin update`) and carries no version marker, **upgrading means re-running the installer** — it is idempotent, so re-running it is also the manual update check.

**Codex hook command.** The hook runs as `node "<payload>/codex-activate.mjs"`, with `node` resolved from `PATH` each time Codex fires it rather than pinned to the node the installer ran on — removing a version-manager (fnm, nvm, volta) node version no longer silently disables it. Codex CLI inherits your shell `PATH`; the Codex app resolves it from your login shell, so `node` must be on the `PATH` your shell startup files set. The handler also sets `additionalContextLimit = 0`: at Codex's default (~2,500 tokens) the largest rule (`hi`) reached the model as a truncated preview. An earlier install moves to this form when you re-run the installer, which rewrites the hook in place together with its trust hash — nothing to re-trust, and an `enabled = false` stays.

To update to a specific version instead of latest, add `--tag <ref>`/`#ref` as in the [One-Line Installer](#one-line-installer) pinning matrix. Pass both to pin everything: `#ref` pins the installer copy itself (the Codex payload and the statusline script are copied from it), `--tag` pins the marketplace / skills channels. For Claude this re-points the marketplace to the ref and reinstalls — `claude plugin marketplace remove scrooge`, then `claude plugin marketplace add Kir93/scrooge-mode#<ref>`, then `claude plugin install scrooge@scrooge`.

### Update notifications

Scrooge checks GitHub for a newer release at most once a day, then surfaces it when you're behind. The check runs in a detached background process — it never blocks or slows a session, and the hooks themselves never touch the network (they only read a cached result).

- **Where it shows:** a one-line hint at the next session start (relayed in your language), plus an `↑vX` marker on the Claude statusline. Updating is the same re-run as above.
- **Check on demand:** re-run `npx -y github:Kir93/scrooge-mode` — it is idempotent and updates every detected host in place. (`npx … -- --version` reports the version of the copy it fetches, not your installed payload.)
- **Opt out:** set `SCROOGE_NO_UPDATE_CHECK=1` to disable the background check and the notice entirely. It is also skipped automatically in CI.
- **Privacy:** the probe is a single unauthenticated GitHub API call (`releases/latest`) — it sends nothing beyond the request itself.

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

`/scrooge-stats` shows the session and lifetime savings. Running `hooks/scrooge-stats.js` directly with `--since 7d` (whole days `d` or hours `h`, e.g. `24h`) scopes the lifetime ledger block to that window. A value in any other form falls back to lifetime totals, labelled `Lifetime`.

Repository-side release verification:

```bash
npm test
python3 -m unittest discover -s benchmarks -p 'test_*.py'
npx markdownlint-cli2@0.23.2 "**/*.md"
node -e "JSON.parse(require('fs').readFileSync('plugin/registry.json'))"
```

The markdownlint line needs Node.js 22 or newer — `markdownlint-cli2@0.23.2` declares `engines.node: >=22`, above the Prerequisites floor.

## Statusline

The token-savings badge (`[SCROOGE:en/full] ⛏ ~12.3k saved (est)`) is wired only by
the **one-line installer**. Plugin manifests cannot declare a `statusLine`, so the
`claude plugin marketplace add` + `claude plugin install` path — the one the
`/plugin` Discover pane uses — **does not wire it**, and says nothing about that.
The README host table's `Statusline ✓` means "supported on this host", not
"wired by every install path".

To add it by hand, point `statusLine` at the installed plugin's script:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/.claude/plugins/cache/scrooge/scrooge/<version>/hooks/scrooge-statusline.sh\""
  }
}
```

The installer only writes `statusLine` when the key is absent, so it never
overwrites an existing statusline (a `claude-hud`-style bar keeps working — but
then the badge is yours to compose). On Windows the badge needs `bash` on PATH; see
[Platform support](#platform-support).

To keep the badge but drop its savings suffix, export `SCROOGE_STATUSLINE_SAVINGS=0`
in your shell profile before launching Claude Code.

## Platform support

Linux and macOS are the CI-verified platforms — every push runs `npm test` on `ubuntu-latest`. **Windows is best-effort, not CI-verified.** The installer carries Windows branches (path handling, `where` probe, shell spawn, `EPERM`/`EISDIR` cleanup) and a PowerShell shim, but no `windows-latest` job exercises them, so treat Windows as unsupported for release guarantees. Three known limits are documented, not closed:

- **`install.ps1` / `uninstall.ps1`** are thin shims that delegate to `node cli/install.js`. They are not run in CI; validate them manually on Windows.
- **Symlink hardening is weaker on Windows.** The atomic state writer opens with `O_NOFOLLOW` to refuse a target swapped for a symlink, but `fs.constants.O_NOFOLLOW` is absent on Windows and falls back to `0` (`plugin/hooks/scrooge-config.js`), so that open-time symlink refusal is a no-op there. The sanitized-key path containment still applies; only the symlink-swap guard is lost.
- **The statusline badge does not run on Windows.** The installer wires `statusLine` as `bash "<config>/hooks/scrooge-statusline.sh"` — a shell script invoked through `bash`, which is not on a stock Windows PATH. Scope: the badge only. Activation, the per-turn reinject hook, and `/scrooge-stats` are plain Node and work normally; you simply see no token counter in the status bar. Installing Git Bash (or WSL) and putting `bash` on PATH makes it work.

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

Scrooge always installs skills at user (global) scope, so `.agents/`, `skills/<name>`, or `skills-lock.json` should never appear in **a project**.

Note the two scopes are not the same thing. **User scope — `~/.agents/skills/` — is the standard's convergent location, not leakage**: it is where `npx skills add … -g` writes, and Codex loads it. The other skills-CLI profiles target that same location per the standard — we have not verified each one reads it. That directory is supposed to exist. Only a **project-local** `.agents/` is leftover to clean up. If you find leftovers from an older version, clean up by running the skills CLI removal for each installed agent (e.g. `npx -y skills remove Kir93/scrooge-mode -a codex`) and deleting any remaining `.agents/` or `skills-lock.json` from the project root.

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
claude plugin marketplace remove scrooge
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

`--uninstall` always removes Scrooge from every host, so it cannot be combined with `--only` (the installer exits with status 2). It removes the `settings.json` `statusLine` only when it is exactly the entry the installer wrote — `{"type": "command", "command": "bash \"<config>/hooks/scrooge-statusline.sh\""}`. A customized `statusLine` that calls the script is kept, together with the script, and the uninstaller prints a NOTE so you can remove both by hand.

For `skills` CLI installs, remove the `scrooge` skill through the target agent's skill manager or skills directory. The project uninstaller removes Claude plugin/statusline wiring and Codex hook payloads; it does not own every third-party skills manager's storage.
