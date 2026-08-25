#!/usr/bin/env python3
"""Regression tests for the zero-quota transcript scanner.

It is the only harness whose numbers land in `README.md` without a committed
JSONL behind them, so a silent change here republishes a different figure with
nothing to diff against. Each test pins a defect that was measured on real
transcripts, not an imagined one.

Collected by CI's `unittest discover -s benchmarks -p 'test_*.py'` on the file
name alone, so no `package.json` or workflow edit is involved.
"""
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest


def _load(name, rel):
    """Load a hyphenated sibling script (not importable by name)."""
    here = pathlib.Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


SCAN = _load("_tscan", "transcript-scan.py")

BANNER = "SCROOGE MODE ACTIVE — ko/full + lean. Apply this register to every response"


def hook_injection():
    return {"type": "attachment",
            "attachment": {"type": "hook_success", "hookEvent": "SessionStart",
                           "stdout": json.dumps({"hookSpecificOutput": {
                               "additionalContext": BANNER}}, ensure_ascii=False)}}


def hook_countermand(lang="ko"):
    text = "SCROOGE OFF — 압축 모드 해제. 이번 턴부터 평소 register(일반 문체)로 복귀."
    return {"type": "attachment",
            "attachment": {"type": "hook_success", "hookEvent": "UserPromptSubmit",
                           "stdout": json.dumps({"hookSpecificOutput": {
                               "additionalContext": text}}, ensure_ascii=False)}}


def user_turn(text="다음 작업 진행해줘"):
    return {"type": "user", "message": {"role": "user",
                                        "content": [{"type": "text", "text": text}]}}


def assistant(*tool_uses, text=None):
    content = [{"type": "text", "text": text}] if text else []
    for name, inp in tool_uses:
        content.append({"type": "tool_use", "name": name, "input": inp})
    return {"type": "assistant", "message": {"role": "assistant", "content": content}}


def write_session(records) -> pathlib.Path:
    tmp = pathlib.Path(tempfile.mkdtemp()) / "proj"
    tmp.mkdir(parents=True)
    path = tmp / "session.jsonl"
    with path.open("w", encoding="utf-8") as out:
        for rec in records:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return path


class TestInjectionDetector(unittest.TestCase):
    """The banner appearing in a record is NOT the same as a hook emitting it.

    Measured across this machine's transcripts: 96 records carry the banner as
    ordinary content — an assistant message discussing the hook, a `cat hooks/*.js`
    tool result, a grep hit — because sessions that work ON this repo quote it. A
    substring test over the whole record reads every one as a fresh injection.
    """

    def test_a_hook_attachment_is_an_injection(self):
        self.assertTrue(SCAN.is_injection(hook_injection()))

    def test_an_assistant_message_quoting_the_banner_is_not(self):
        self.assertFalse(SCAN.is_injection(assistant(text=f"주입 문자열은 `{BANNER}`임")))

    def test_a_tool_result_quoting_the_banner_is_not(self):
        rec = {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": f"156:  `{BANNER}` +"}]}}
        self.assertFalse(SCAN.is_injection(rec))

    def test_an_echoed_banner_neither_resets_drift_nor_drops_the_turn(self):
        # Both halves of the same bug: the drift counter went back to 0, and the
        # commit in that very assistant turn vanished, because the scan skipped
        # any record it had read as an injection.
        path = write_session([
            hook_injection(),
            user_turn(), user_turn(), user_turn(),
            assistant(("Bash", {"command": 'git commit -m "fix: 주입 배너 감지 수정"'}),
                      text=f"배너는 `{BANNER}` 형태임"),
        ])
        rows = SCAN.scan_session(path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["drift_turns"], 3)


class TestDeactivation(unittest.TestCase):
    """`/scrooge off` ends the measured window; `active` must not latch.

    The hook emits a `SCROOGE OFF` countermand (`buildCountermand`, same prefix in
    all five languages). Without reading it, everything a user writes after turning
    the register off is scored as if it were still on — and the register is exactly
    what those rows are supposed to be evidence about.
    """

    def test_an_artifact_after_off_is_not_collected(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 켜진 동안"'})),
            hook_countermand(),
            assistant(("Bash", {"command": 'git commit -m "fix: 꺼진 뒤"'})),
        ]))
        self.assertEqual([r["artifact"] for r in rows], ["fix: 켜진 동안"])

    def test_a_later_injection_reopens_the_window(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            hook_countermand(),
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 다시 켠 뒤"'})),
        ]))
        self.assertEqual([r["artifact"] for r in rows], ["fix: 다시 켠 뒤"])


class TestRegisterLanguage(unittest.TestCase):
    """Each row carries the register language its banner named.

    `persistence-score.py` reads Korean endings only, so an `en/full` session's
    artifacts would score clean by construction. The summary drops them; that is
    only possible if the language is recorded here.
    """

    def test_the_banner_language_is_recorded(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 한국어"'})),
        ]))
        self.assertEqual(rows[0]["lang"], "ko")

    def test_a_non_korean_banner_is_recorded_as_such(self):
        en = {"type": "attachment", "attachment": {
            "type": "hook_success", "hookEvent": "SessionStart",
            "stdout": json.dumps({"hookSpecificOutput": {"additionalContext":
                "SCROOGE MODE ACTIVE — en/full + lean. Apply this register"}})}}
        rows = SCAN.scan_session(write_session([
            en, assistant(("Bash", {"command": 'git commit -m "fix: english subject"'})),
        ]))
        self.assertEqual(rows[0]["lang"], "en")


class TestArtifactClasses(unittest.TestCase):
    """All three `## Boundaries` classes are extractable with no `=== OUTPUT ===`.

    The fence exists because prose has no edge the scorer can find. A tool
    argument does: the whole argument IS the artifact. Scanning only
    `git commit -m` left the PR class — 129 of 163 `gh pr` calls on this machine
    write the body to a file first — and the outbound class at zero coverage,
    while the docs claimed both were covered.
    """

    def test_commit_body(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 경계 회귀 수정"'})),
        ]))
        self.assertEqual([r["class"] for r in rows], ["commit"])
        self.assertEqual(rows[0]["artifact"], "fix: 경계 회귀 수정")

    def test_pr_body_file_is_resolved_back_to_its_writer(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Write", {"file_path": "/tmp/pr-body.md",
                                 "content": "# 배경\n\n만료 검증을 고쳤습니다.\n"})),
            user_turn(),
            assistant(("Bash", {"command": "gh pr create --title t "
                                           "--body-file /tmp/pr-body.md"})),
        ]))
        self.assertEqual([r["class"] for r in rows], ["pr"])
        self.assertIn("만료 검증", rows[0]["artifact"])

    def test_pr_body_file_written_by_heredoc(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": "cat > /tmp/b.md <<'EOF'\n"
                                           "# 배경\n\n로직을 정리했습니다.\nEOF"})),
            assistant(("Bash", {"command": "gh pr edit 3 --body-file /tmp/b.md"})),
        ]))
        self.assertEqual([r["class"] for r in rows], ["pr"])
        self.assertIn("정리했습니다", rows[0]["artifact"])

    def test_outbound_slack_text(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("mcp__someworkspace__slack_send_message",
                       {"channel": "#fe", "text": "🚀 v1.2.0 배포했습니다."})),
        ]))
        self.assertEqual([r["class"] for r in rows], ["outbound"])
        self.assertTrue(rows[0]["prose_shaped"])

    def test_nothing_is_collected_before_the_first_injection(self):
        rows = SCAN.scan_session(write_session([
            assistant(("Bash", {"command": 'git commit -m "chore: register 비활성"'})),
        ]))
        self.assertEqual(rows, [])


class TestMeasurementPower(unittest.TestCase):
    """`prose_shaped` is what keeps "0 violations" from being a tautology.

    Measured: 538 of 540 commit artifacts on this machine are single-line Korean
    subjects (`type: 한글 설명`) with no terminal punctuation — a shape that cannot
    carry any ending the scorer looks for, whatever the register did. Reporting
    them in the same total as prose artifacts inflates a clean rate out of
    artifacts that could never have been dirty.
    """

    def test_a_single_line_commit_subject_is_not_prose_shaped(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 상태 파일 경로 정리"'})),
        ]))
        self.assertFalse(rows[0]["prose_shaped"])
        self.assertFalse(rows[0]["violated"])

    def test_a_multi_line_or_punctuated_artifact_is(self):
        rows = SCAN.scan_session(write_session([
            hook_injection(),
            assistant(("Bash", {"command": 'git commit -m "fix: 정리\n\n본문이 있습니다."'})),
        ]))
        self.assertTrue(rows[0]["prose_shaped"])


if __name__ == "__main__":
    unittest.main()
