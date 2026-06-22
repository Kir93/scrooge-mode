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

대부분 사용자 권장 경로. Claude Code, Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI 자동 감지 후 맞는 integration 설치.

```bash
npx -y github:Kir93/scrooge-mode
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
npx -y github:Kir93/scrooge-mode#v0.6.1

# installer가 구동하는 marketplace / skills 채널에도 tag 전달
npx -y github:Kir93/scrooge-mode#v0.6.1 -- --tag v0.6.1
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

## 플래그 (lean 기본 on)

`lean`(코드 산출물 최소주의)은 **기본 on** — `/scrooge`가 과설계·해설을 덜어 ~21% 더 깎되 정확성은 절대 양보 안 함(fragment가 안전 바닥 고정). `ctx`(컨텍스트 절약)은 **opt-in**. 기본값 변경:

- 세션 단위: `/scrooge … nolean`(lean 해제) 또는 `/scrooge … ctx`(ctx 추가).
- shell 프로필로 전역:

```bash
export SCROOGE_DEFAULT_FLAGS=lean,ctx   # ctx 추가
export SCROOGE_DEFAULT_FLAGS=           # 전체 해제
```

`lean`/`ctx`만 적용 — 미지 토큰은 무시. `max`는 둘 다 켜는 slash 전용 preset. (`/scrooge …` 활성화는 **글로벌 기본값**도 저장해 `/scrooge off` 전까지 새 세션을 자동 활성화.)

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

latest 대신 특정 버전으로 업데이트하려면 [One-Line Installer](#one-line-installer) 핀 matrix처럼 `--tag <ref>`/`#ref` 추가. Claude는 marketplace를 해당 ref로 재지정 후 재설치 — `claude plugin marketplace remove scrooge`, `claude plugin marketplace add Kir93/scrooge-mode#<ref>`, `claude plugin install scrooge@scrooge` 순서.

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

scrooge는 항상 user(global) scope로 설치하므로 프로젝트에 `.agents/`, `skills/<name>`, `skills-lock.json` 생기지 않음. 구버전 잔재 발견되면 설치된 agent별로 skills CLI 제거 (`npx -y skills remove Kir93/scrooge-mode -a codex` 등) 후 프로젝트 루트에 남은 `.agents/`·`skills-lock.json` 수동 삭제.

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
