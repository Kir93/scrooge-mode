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

## Verify

설치 후 대상 agent에서 Scrooge 활성화:

```text
/scrooge ko full
```

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
