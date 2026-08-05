# 설치

[English](INSTALL.md) · 한국어

Scrooge 설치 경로 3개: Claude Code plugin, skills ecosystem, 멀티 에이전트 installer. 하나만 고르면 됨. 대부분은 installer 권장.

## Prerequisites

- Node.js 18 이상.
- `github.com/Kir93/scrooge-mode` 접근 가능.
- 대상 에이전트 설치됨: plugin 경로는 Claude Code, skills 경로는 Codex 또는 `skills` 지원 에이전트.
- 원라이너는 홈 디렉토리(`cd ~`)에서 실행 권장. 현재 repo에 `skills` CLI project-scope 파일 생기는 것 방지.

## Claude Code Plugin Path

Claude Code만 연결할 때 사용.

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

검증:

```bash
claude plugin list
```

Claude Code 세션에서 활성화:

```text
/scrooge ko full
```

제거:

```bash
claude plugin uninstall scrooge@scrooge
```

원라이너로 statusline까지 설치했다면 project uninstaller도 실행.

> **caveman·grill-me 등 다른 출력 압축 register를 함께 쓰고 있다면:** 하나를
> 끄세요. 둘 다 같은 `UserPromptSubmit` 이벤트로 매 턴 스타일 지시를 주입하는데
> 서로를 볼 수 없어서, 모델은 상충하는 지시를 받습니다(caveman issue #574).
> one-line installer는 감지 시 경고를 출력하지만, **이 plugin 경로는 그 installer를
> 거치지 않으므로 여기서는 경고할 수 없습니다.**

## Codex Skills Ecosystem Path

`skills` ecosystem으로 설치할 때 사용. Codex와 다른 supported agent 대상.

skill 목록 확인:

```bash
npx skills add Kir93/scrooge-mode --list
```

Codex 설치:

```bash
npx skills add Kir93/scrooge-mode -a codex --yes --all
```

다른 profile은 `codex`를 `cursor`, `windsurf`, `cline`, `continue`, `gemini-cli` 등으로 교체.

검증:

```bash
npx skills add Kir93/scrooge-mode --list
```

제거는 대상 agent의 `skills` manager layout에 따름. 해당 agent의 skill manager 또는 skills directory에서 `scrooge` skill 제거. Codex를 원라이너로 설치했다면 Codex hook payload 제거를 위해 project uninstaller도 실행.

## One-Line Installer

대부분 사용자 권장 경로. Claude Code, Codex, Cursor, Windsurf, Cline, Continue를 자동 감지해 맞는 integration을 설치합니다.

```bash
npx -y github:Kir93/scrooge-mode
```

**Gemini CLI는 자동 감지 대상이 아니라 opt-in입니다.** 탐지가 best-effort라 기본 실행에서는 제외되며, 설치하려면 직접 지정해야 합니다.

```bash
npx -y github:Kir93/scrooge-mode -- --only gemini
```

macOS / Linux shell 대안:

```bash
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash
```

Windows PowerShell 대안:

```powershell
irm https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.ps1 | iex
```

유용한 flag:

```bash
npx -y github:Kir93/scrooge-mode -- --dry-run
npx -y github:Kir93/scrooge-mode -- --only claude
```

release 버전 핀(재현 가능한 설치 — 원하는 release tag로 교체):

```bash
# curl|bash / npx — npm git-ref로 직접 핀(보장)
npx -y github:Kir93/scrooge-mode#v0.21.0

# installer가 구동하는 marketplace / skills 채널에도 tag 전달
npx -y github:Kir93/scrooge-mode#v0.21.0 -- --tag v0.21.0
```

| 채널 | tag 핀 |
| ---- | ------ |
| `npx -y github:<repo>#<tag>` | ✅ 보장(npm git-ref) |
| `--tag <ref>` → `claude plugin marketplace add` | best-effort — `claude` CLI가 git ref를 해석하면 적용 |
| `--tag <ref>` → `npx skills add` | best-effort — `skills` CLI가 git ref를 해석하면 적용 |

tag 없으면 모든 채널이 `main`을 추적.

제거:

```bash
npx -y github:Kir93/scrooge-mode -- --uninstall
```

로컬 clone:

```bash
./uninstall.sh
```

Windows PowerShell:

```powershell
./uninstall.ps1
```

## 설정 파일 안전장치

설치·제거는 사용자 소유 파일 2개를 수정합니다.

| 파일 | 수정 시점 |
| ---- | --------- |
| `<claude-config>/settings.json` (기본값 `~/.claude/settings.json`) | 설치 시 statusline 연결, 제거 시 statusline 해제 |
| `~/.codex/config.toml` | 설치 시 Codex hook 연결, 제거 시 hook 해제 |

두 파일 중 하나를 처음 수정하기 전에 설치 프로그램이 `<path>.bak`으로 복사합니다. 이 복사본은 **한 번만** 만들어집니다 — 설치 이전 상태의 스냅샷이며, 이후의 설치나 제거가 덮어쓰지 않습니다. 제거 시에도 `.bak`은 일부러 남겨두므로, 더 이상 필요 없으면 직접 삭제하세요.

수정은 같은 디렉터리의 임시 파일에 쓴 뒤 대상 파일로 rename하는 방식입니다. 따라서 쓰기가 중단되어도(크래시, 디스크 가득 참, Ctrl-C) 원본이 잘리지 않고 그대로 남습니다. 파일 권한도 유지됩니다.

두 경로 중 하나가 심볼릭 링크인 경우 — dotfiles 저장소를 `~/.claude/settings.json`으로 연결한 구성 — 설치 프로그램은 링크를 따라가 실체 파일을 수정하고 링크 자체는 그대로 둡니다. 이때 `.bak`은 링크가 아니라 **실체 파일** 옆에 생성되므로 복구도 그 위치에서 하세요.

복구 방법:

```bash
mv ~/.claude/settings.json.bak ~/.claude/settings.json
mv ~/.codex/config.toml.bak ~/.codex/config.toml
```

## 플래그 (lean 기본 on)

`lean`(코드 산출물 최소주의)은 **기본 on** — `/scrooge`가 과설계·해설을 덜되 정확성은 절대 양보 안 함(fragment가 안전 바닥 고정). `full` 위에서 같은 register의 flag 없는 arm과 paired 측정: **KO +34.6%**(n=22) / **EN +10.3%**(n=21), est·prose-only·`claude-opus-4-8`. 재현: `python3 benchmarks/report.py --input results-lean2-{ko,en}.jsonl --baseline scrooge:{ko,en}/full --paired`. 기본값 변경:

- 세션 단위: `/scrooge … nolean`(lean 해제).
- shell 프로필로 전역:

```bash
export SCROOGE_DEFAULT_FLAGS=lean       # lean on (기본값)
export SCROOGE_DEFAULT_FLAGS=           # 전체 해제
```

`lean`만 적용 — 미지 토큰은 무시. (`/scrooge …` 활성화는 **글로벌 기본값**도 저장해 `/scrooge off` 전까지 새 세션을 자동 활성화.)

## v0.23.0에서 제거: `memory-compress`

선택 CLI였던 `memory-compress`(CLAUDE.md·AGENTS.md 입력측 압축)를 제거했습니다.
자체 측정이 근거입니다 — Phase 0 floor 7.7%, 후속 context-audit의 실현 가능 중앙값
~3~4%, 그리고 prompt caching이 캐시된 prefix를 input 요금의 약 1/10로 청구하므로
그 prefix를 압축해 얻는 값이 사실상 없습니다. Scrooge는 **출력측** register이고,
이제 그것이 제품 전부입니다. 기존 CLI가 기록한 ledger 항목은 그대로 읽히며 무시됩니다.

## Update

installer를 다시 실행하면 감지된 전 에이전트가 그 자리에서 최신화됨 — Scrooge는 재실행 안전.

```bash
npx -y github:Kir93/scrooge-mode
```

**Claude Code**는 이제 이미 설치된 plugin을 skip하지 않음. marketplace catalog를 새로고침하고 plugin을 최신 버전으로 업데이트:

```bash
claude plugin marketplace update scrooge
claude plugin update scrooge@scrooge
```

`claude plugin update`는 다음 Claude Code 재시작 때 적용되므로 이후 세션을 재시작.

업데이트 후 첫 새 세션에서 재활성화 방법을 1회 안내함 — 버전 변경이 활성화를 리셋할 수 있기 때문. `/scrooge ko full`를 한 번 실행하면 글로벌 기본값이 이후 모든 세션을 `/scrooge off` 전까지 활성 유지.

**Codex**는 재실행 시 hook payload(hooks, rules, lib, registry)를 overwrite하고 `~/.codex/config.toml` hook을 멱등 재머지함. **다른 skills 에이전트**(Cursor, Windsurf, Cline, Continue, Gemini CLI)는 재실행 시 `scrooge` skill이 overwrite됨. 어느 쪽이든 자동으로 최신을 받음.

> **Codex tier 한계.** Codex 통합은 `UserPromptSubmit` hook만 배선하고 `SessionStart`는 미배선 — 세션 내 업데이트 알림과 `↑vX` statusline 마커가 Codex에는 뜨지 않음. 새 릴리스는 `scrooge --version`으로 수동 확인하고, Codex payload는 copy 방식(in-place `plugin update` 없음)이라 **업그레이드 = installer 재실행**.

latest 대신 특정 버전으로 업데이트하려면 [One-Line Installer](#one-line-installer) 핀 matrix처럼 `--tag <ref>`/`#ref` 추가. Claude는 marketplace를 해당 ref로 재지정 후 재설치 — `claude plugin marketplace remove scrooge`, `claude plugin marketplace add Kir93/scrooge-mode#<ref>`, `claude plugin install scrooge@scrooge` 순서.

### 업데이트 알림

Scrooge는 하루 최대 1회 GitHub에서 새 릴리스를 확인해, 뒤처졌을 때 알림. 확인은 detached 백그라운드 프로세스에서 수행 — 세션을 막거나 느리게 하지 않으며, hook 자체는 네트워크를 건드리지 않고 캐시된 결과만 읽음.

- **표시 위치:** 다음 세션 시작 시 한 줄 힌트(사용자 언어로 전달) + Claude statusline의 `↑vX` 마커. 업데이트는 위와 동일한 재실행.
- **수동 확인:** `scrooge --version`(또는 `npx -y github:Kir93/scrooge-mode -- --version`)으로 설치 버전 + 새 릴리스 유무 출력.
- **끄기:** `SCROOGE_NO_UPDATE_CHECK=1` 설정 시 백그라운드 확인·알림 전체 비활성. CI에서는 자동 skip.
- **프라이버시:** 미인증 GitHub API 1회 호출(`releases/latest`) — 요청 자체 외 아무 데이터도 전송 안 함.

## Verify

설치 후 대상 agent에서 Scrooge 활성화:

```text
/scrooge ko full
```

Claude Code hook에선 자연어로도 활성화 — "스크루지처럼 답해줘" / "talk like scrooge"로 켜고, "스크루지 꺼" / "stop scrooge"로 해제.

예상 동작:

- 명령이 `ko/full` 활성화.
- 후속 답변은 `/scrooge off` 전까지 압축 한국어 register 사용.
- code block, error string, technical identifier 원문 유지.
- 보안 경고와 되돌릴 수 없는 동작 확인은 normal prose로 복귀.

Repo-side release 검증:

```bash
npm test
npx markdownlint-cli2 "**/*.md"
node -e "JSON.parse(require('fs').readFileSync('registry.json'))"
```

## Statusline

토큰 절감 배지(`[SCROOGE:ko/full] ⛏ ~12.3k saved (est)`)는 **one-line installer**만
배선합니다. plugin manifest는 `statusLine`을 선언할 수 없으므로,
`claude plugin marketplace add` + `claude plugin install` 경로 — `/plugin` Discover
창이 쓰는 그 경로 — 는 **배선하지 않으며 그 사실을 알려주지도 않습니다.** README
호스트 표의 `Statusline ✓`는 "이 호스트에서 지원됨"이지 "모든 설치 경로가 배선함"이
아닙니다.

수동으로 추가하려면 설치된 plugin의 스크립트를 `statusLine`에 지정하세요:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/.claude/plugins/cache/scrooge/scrooge/<version>/hooks/scrooge-statusline.sh\""
  }
}
```

installer는 `statusLine` 키가 없을 때만 기록하므로 기존 statusline을 덮어쓰지
않습니다(`claude-hud` 같은 바가 그대로 동작 — 대신 배지 합성은 사용자 몫).
Windows에서는 `bash`가 PATH에 있어야 합니다 — [플랫폼 지원](#platform-support) 참고.

## Platform support

Linux·macOS가 CI 검증 플랫폼 — 매 push마다 `ubuntu-latest`에서 `npm test` 실행. **Windows는 best-effort, CI 미검증.** installer에 Windows 분기(경로 처리, `where` 프로브, shell spawn, `EPERM`/`EISDIR` 정리)와 PowerShell shim이 있으나 `windows-latest` job이 이를 실행하지 않으므로 릴리스 보장 대상에서 Windows는 unsupported로 간주. 세 known-limit는 닫지 않고 문서화만:

- **`install.ps1` / `uninstall.ps1`**은 `node bin/install.js`로 위임하는 얇은 shim. CI 미실행 — Windows에서 수동 검증 필요.
- **Windows에선 symlink 보호가 약함.** atomic state writer는 symlink로 바꿔치기된 target을 거부하려 `O_NOFOLLOW`로 open하지만, Windows엔 `fs.constants.O_NOFOLLOW`가 없어 `0`으로 폴백(`hooks/scrooge-config.js`)돼 open 시점 symlink 거부가 no-op. sanitized-key 경로 격리는 유지되고 symlink-swap 가드만 상실.
- **Windows에서는 statusline 배지가 동작하지 않음.** installer가 `statusLine`을 `bash "<config>/hooks/scrooge-statusline.sh"`로 배선하는데, `bash`는 기본 Windows PATH에 없음. 영향 범위는 배지뿐 — 활성화·매 턴 reinject hook·`/scrooge-stats`는 순수 Node라 정상 동작하고, 상태 표시줄에 토큰 카운터만 안 뜸. Git Bash(또는 WSL)를 설치해 `bash`를 PATH에 올리면 동작.

## Troubleshooting

### Node Version Too Old

installer가 Node 없음/버전 낮음 보고 시 Node.js 18 이상 설치 후 재실행.

```bash
node --version
```

### Claude CLI Missing

Claude Code plugin 경로는 `PATH`에 `claude` 필요.

```bash
command -v claude
```

실패하면 Claude Code 먼저 설치하거나 다른 agent는 `skills` ecosystem 경로 사용.

### Project-Scope Skills Files Appear

scrooge는 항상 user(global) scope로 설치하므로 **프로젝트에** `.agents/`, `skills/<name>`, `skills-lock.json` 생기지 않음.

두 scope는 다릅니다. **user scope인 `~/.agents/skills/`는 누출이 아니라 표준의 수렴 위치**입니다 — `npx skills add … -g`가 쓰는 경로이며 Codex가 로드하고 Windsurf가 탐지하며 Gemini CLI가 alias합니다. 그 디렉토리는 있는 게 정상입니다. 청소 대상은 **프로젝트 로컬** `.agents/`뿐입니다. 구버전 잔재 발견되면 설치된 agent별로 skills CLI 제거 (`npx -y skills remove Kir93/scrooge-mode -a codex` 등) 후 프로젝트 루트에 남은 `.agents/`·`skills-lock.json` 수동 삭제.

### Permission Errors

shell script 실행 권한 오류:

```bash
chmod +x install.sh uninstall.sh
```

config 파일 쓰기 실패 시 `~/.claude` 또는 `~/.codex` 소유권 확인 후 재실행.

## Uninstall

설치한 경로와 같은 채널로 제거.

Claude Code plugin:

```bash
claude plugin uninstall scrooge@scrooge
```

원라이너:

```bash
npx -y github:Kir93/scrooge-mode -- --uninstall
```

로컬 clone:

```bash
./uninstall.sh
```

Windows PowerShell:

```powershell
./uninstall.ps1
```

`skills` CLI install은 대상 agent skill manager 또는 skills directory에서 `scrooge` skill 제거. project uninstaller는 Claude plugin/statusline wiring과 Codex hook payload를 제거함. 모든 third-party skills manager 저장소까지 소유하지는 않음.
