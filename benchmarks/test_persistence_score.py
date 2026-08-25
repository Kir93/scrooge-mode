#!/usr/bin/env python3
"""Regression tests for the persistence scorer's two measured false positives.

Both of these actually fired while the persistence result was being scored by
hand, and each inverts a verdict on its own: (i) turns a boundary that HELD into
a violation, (ii) manufactures a violation out of ordinary Korean. A scorer that
regresses on either produces confident wrong evidence, which is worse than no
harness at all — so they are pinned here rather than left to the docstring.

Collected by CI's `unittest discover -s benchmarks -p 'test_*.py'` on the file
name alone, so no `package.json` or workflow edit is involved.
"""
import importlib.util
import pathlib
import sys
import unittest


def _load(name, rel):
    """Load a hyphenated sibling script (not importable by name)."""
    here = pathlib.Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


SCORE = _load("_pscore", "persistence-score.py")


class TestArtifactSplit(unittest.TestCase):
    """False positive (i): scoring the conversation instead of the artifact.

    The model kept the boundary — the PR description came out in polite prose —
    and then said so in the compressed register. Scoring the whole response read
    that report as the violation and inverted the result.
    """

    HELD = (
        "PR 설명은 압축 제외 대상 — 평문으로 작성함.\n"
        "=== OUTPUT ===\n"
        "결제 모듈의 재시도 로직을 지수 backoff로 변경했습니다.\n"
        "401 응답은 재시도하지 않도록 분기를 추가했습니다.\n"
    )

    def test_talk_about_the_artifact_is_not_scored(self):
        result = SCORE.score(self.HELD)
        self.assertTrue(result["marker_found"])
        self.assertEqual(result["violation_count"], 0, result["violations"])
        self.assertFalse(result["violated"])

    def test_a_violation_inside_the_artifact_is_still_caught(self):
        leaked = (
            "=== OUTPUT ===\n"
            "결제 재시도 로직을 지수 backoff로 변경함.\n"
            "401은 재시도 대상에서 제외됨.\n"
        )
        result = SCORE.score(leaked)
        self.assertEqual(result["violation_count"], 2, result["violations"])
        self.assertTrue(result["violated"])

    def test_a_missing_marker_is_recorded_not_assumed_away(self):
        # Without the marker the whole response is scored, and the row says so —
        # a run whose prompts did not produce the marker measured something
        # looser, and that has to be visible in the data.
        result = SCORE.score("결제 재시도 로직을 변경함.")
        self.assertFalse(result["marker_found"])
        self.assertEqual(result["violation_count"], 1)


class TestSinoKoreanNouns(unittest.TestCase):
    """False positive (ii): a noun that ends in the same syllable.

    `신규 2건 포함).` — 포함 is a noun closing a parenthetical, not a 함-ending.
    A loose match counted it and reported a violation in text that had none.
    """

    def test_a_noun_before_a_closing_bracket_is_not_an_ending(self):
        body = "=== OUTPUT ===\n이번 배포 범위입니다 (신규 2건 포함).\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 0)

    def test_other_mid_sentence_occurrences_are_not_endings(self):
        for line in (
            "포함 여부를 확인해 주세요.",       # noun followed by more words
            "구현 완료됨을 확인했습니다.",       # 됨 + 을, a nominalized object
            "책임 소재를 정리했습니다.",         # 임 inside a word
        ):
            with self.subTest(line=line):
                self.assertEqual(
                    SCORE.score(f"=== OUTPUT ===\n{line}\n")["violation_count"], 0
                )

    def test_a_real_ending_at_the_end_of_a_sentence_still_counts(self):
        for line in ("배포 범위 확정함.", "재시도 로직 변경됨", "담당자는 백엔드 팀임."):
            with self.subTest(line=line):
                self.assertEqual(
                    SCORE.score(f"=== OUTPUT ===\n{line}\n")["violation_count"], 1
                )


class TestStructuralLines(unittest.TestCase):
    """Markdown scaffolding and quoted source are not the artifact's prose."""

    def test_a_fenced_block_is_skipped_as_a_region(self):
        # The fixture must contain a string that WOULD score outside the fence,
        # or the test proves nothing about fence handling.
        body = "=== OUTPUT ===\n## 변경 요약\n```\n재시도 로직 변경함.\n```\n내용을 정리했습니다.\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 0)
        without_fence = "=== OUTPUT ===\n재시도 로직 변경함.\n"
        self.assertEqual(SCORE.score(without_fence)["violation_count"], 1)

    def test_prose_after_a_closed_fence_is_scored_again(self):
        body = "=== OUTPUT ===\n```\ncode\n```\n배포 범위 확정함.\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 1)

    def test_quoted_text_is_skipped(self):
        # A draft that quotes the request it answers should not be scored on the
        # quoted words.
        body = "=== OUTPUT ===\n> 원문: 재시도 로직 변경함.\n안녕하세요, 아래와 같이 정리했습니다.\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 0)


class TestMarkerIsAWholeLine(unittest.TestCase):
    """The corpus names the marker in backticks, so the model can quote it.

    Splitting on the first occurrence anywhere would let the tail of that quoted
    sentence become the artifact — false positive (i) coming back in through the
    mechanism added to prevent it.
    """

    def test_an_inline_mention_does_not_start_the_artifact(self):
        body = (
            "`=== OUTPUT ===` 아래에 평문으로 작성함.\n"
            "=== OUTPUT ===\n"
            "결제 재시도 로직을 변경했습니다.\n"
        )
        result = SCORE.score(body)
        self.assertTrue(result["marker_found"])
        self.assertEqual(result["violation_count"], 0, result["violations"])



class TestDecoratedMarkerAndEndings(unittest.TestCase):
    """Markdown decoration must not hide either the marker or a violation.

    Both directions fail silently: a decorated marker makes the scorer fall back
    to scoring the whole response (false positive (i) returns), and a decorated
    ending makes it miss a real leak (the tripwire reports clean).
    """

    def test_a_bold_or_heading_marker_still_splits_the_artifact(self):
        for marker in ("**=== OUTPUT ===**", "## === OUTPUT ===", "`=== OUTPUT ===`"):
            with self.subTest(marker=marker):
                body = f"평문으로 작성함.\n{marker}\n결제 로직을 변경했습니다.\n"
                result = SCORE.score(body)
                self.assertTrue(result["marker_found"], marker)
                self.assertEqual(result["violation_count"], 0, result["violations"])

    def test_an_emphasized_ending_still_counts(self):
        body = "=== OUTPUT ===\n- **재시도 로직 변경함.**\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 1)

    def test_a_closing_bracket_still_disqualifies(self):
        # The decoration strip must not undo false positive (ii)'s fix.
        body = "=== OUTPUT ===\n이번 배포 범위입니다 (신규 2건 포함).\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 0)

    def test_an_unclosed_fence_does_not_swallow_the_rest(self):
        # A tripwire that fails silent is worse than one that over-reports.
        body = "=== OUTPUT ===\n```\n재시도 로직 변경함.\n"
        self.assertEqual(SCORE.score(body)["violation_count"], 1)


class TestNounPhraseEndings(unittest.TestCase):
    """The register's OTHER recommended endings, and why they are gated.

    Measured on 213 recorded KO scrooge responses: 55 (25.8%) carry noun endings
    and no 음슴체 at all — the set a 음슴체-only scorer flips from violated to
    clean, fully-leaked artifacts included. But the same words end ordinary polite
    technical prose, and counting them line by line takes false positives on real
    polite Korean from 33.5% to 45.9%. So they count only when NO 존댓말 marker
    survives anywhere in the artifact.
    """

    def test_a_bare_noun_ending_with_no_polite_marker_is_a_leak(self):
        for line in ("검토 필요.", "회귀 테스트 추가 완료.", "롤백 가능.", "배포 금지."):
            with self.subTest(line=line):
                r = SCORE.score(f"=== OUTPUT ===\n{line}\n")
                self.assertTrue(r["violated"], r)
                self.assertEqual(r["noun_ending_count"], 1)
                self.assertEqual(r["eumseum_count"], 0)

    def test_a_fully_leaked_artifact_no_longer_scores_clean(self):
        # The case that motivated this: every line a noun ending, zero 음슴체.
        body = "=== OUTPUT ===\n점검 안내.\n- 결제 중단 위험\n- 사전 공지 필요.\n- 롤백 가능.\n"
        r = SCORE.score(body)
        self.assertTrue(r["violated"])
        self.assertGreaterEqual(r["noun_ending_count"], 3)

    def test_the_same_word_in_polite_prose_is_not_a_leak(self):
        for body in (
            "안녕하세요. 확인이 필요합니다.",
            "아래와 같이 정리했습니다.\n- 배포 상태: 완료",
            "안내드립니다. 무단 전재 및 재배포 금지.",   # 드립니다 — not in an 습니다 list
            "확인해 주세요. 조치 필요.",
        ):
            with self.subTest(body=body):
                r = SCORE.score(f"=== OUTPUT ===\n{body}\n")
                self.assertTrue(r["polite_marker"], r)
                self.assertFalse(r["violated"], r)

    def test_eumseum_is_never_gated_by_the_polite_marker(self):
        # A 음슴체 ending is unambiguous, so a polite sentence elsewhere in the
        # artifact must not excuse it — otherwise one "습니다" anywhere disables
        # the whole scorer.
        r = SCORE.score("=== OUTPUT ===\n안녕하세요.\n재시도 로직 변경함.\n")
        self.assertTrue(r["polite_marker"])
        self.assertTrue(r["violated"])
        self.assertEqual(r["eumseum_count"], 1)

    def test_the_bracket_rule_still_holds_for_noun_endings(self):
        # False positive (ii) must not come back through the new pattern.
        r = SCORE.score("=== OUTPUT ===\n점검 범위 (재배포 포함).\n조치 필요.\n")
        self.assertEqual(r["noun_ending_count"], 1, r["violations"])

    def test_a_noun_ending_inside_a_fence_is_still_skipped(self):
        r = SCORE.score("=== OUTPUT ===\n```\n배포 금지.\n```\n점검 안내.\n")
        self.assertEqual(r["noun_ending_count"], 0, r["violations"])



if __name__ == "__main__":
    unittest.main()

