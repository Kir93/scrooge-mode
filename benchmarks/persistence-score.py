#!/usr/bin/env python3
"""Deterministic scorer for register-persistence runs.

The question these runs ask is binary: did the model keep a `## Boundaries`
artifact — a commit message or PR description (permanently excluded), or an
outbound draft (Docs·prose: padding stripped, tone kept) — in normal prose, or did
the compressed register leak into it? A judge model would answer that
with its own variance on top; the giveaway is mechanical, so this counts it
instead.

Two ending families, scored differently, because they are not equally decisive:

  - **음슴체 endings** (`~함` / `~됨` / `~임`) are unambiguous. Polite Korean does
    not end a sentence that way, so each one counts on its own.
  - **Noun-phrase endings** (`필요` / `권장` / `금지` / `가능` / `위험` / `완료`)
    are recommended by the register too (rules/ko/full.md "Use: endings"), and
    they matter: across 213 recorded KO scrooge responses, 55 (25.8%) carry noun
    endings and NO 음슴체 at all — exactly the set a 음슴체-only scorer flips from
    violated to clean, artifacts that leaked completely included. But the same
    words end perfectly polite technical prose ("확인이 필요합니다", "- 배포 상태:
    완료"), and counting them line by line takes false positives on real polite
    Korean from 33.5% to 45.9%. So they count only when the artifact carries no
    uncompressed-register marker anywhere (존댓말 for an outbound draft, 평서형 for
    a PR description — the corpus spans both Boundaries classes) — which is the property actually under test ("did this
    lose its polite register?"), measured at 70.2% recall against 6.4% false
    positives.

Two false positives showed up the first time this was scored by hand, and both
are pinned by `test_persistence_score.py`:

  (i)  The model keeps the boundary and then REPORTS that it did, in the
       compressed register: "PR 설명은 압축 제외 - 평문으로 작성함." That
       sentence is conversation about the artifact, not the artifact. Scoring
       the whole response counts it as a violation and inverts the result. So the
       corpus prompts ask for a marker PAIR and only what sits between them is
       scored. The pair is not decoration: the first live run produced a
       perfectly polite Slack notice followed by a trailing note — "초안만 작성,
       전송 안 함." — below the artifact, and a start-only marker scored that
       note as a leak. Meta lands on both sides, so both sides need a fence.
  (ii) A Sino-Korean noun that happens to end in the same syllable, closing a
       parenthetical: "신규 2건 포함)." - 포함 is a noun here, not a 함-ending.
       The ending only counts when the syllable is the last character of the
       sentence, optionally followed by terminal punctuation. A closing bracket
       between them means it is not a sentence ending.

usage:
  persistence-score.py --input runs.jsonl [--output scored.jsonl]
  persistence-score.py --text-file response.txt      # score one response
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The corpus prompts ask for this line before the artifact so conversation about
# the artifact stays above it. Not a code fence: fencing the artifact would put
# it under the register's own "code blocks stay verbatim" rule and change what
# is being measured.
OUTPUT_MARKER = "=== OUTPUT ==="
END_MARKER = "=== END ==="
# Matched as a WHOLE LINE, after markdown decoration is stripped. The corpus
# prompts name the marker in backticks, so a model that echoes the instruction
# ("`=== OUTPUT ===` 아래에 평문으로 작성함.") would otherwise have the tail of
# that meta sentence read as the artifact — false positive (i) coming back in
# through the mechanism meant to stop it. Decoration is stripped because a
# model writing markdown emits `**=== OUTPUT ===**` or `## === OUTPUT ===` often
# enough that an exact-match anchor would miss the marker and fall back to
# scoring the whole response, which is the same failure.
MARKER_DECORATION = "*_#` \t"

# A 음슴체 ending only counts when its syllable ENDS a sentence: last character
# of the line, or immediately followed by terminal punctuation. Word-boundary is
# NOT enough — `포함 여부를` and `책임 소재를` end an eojeol, not a sentence — and
# an intervening bracket disqualifies it, which is false positive (ii)
# (`신규 2건 포함).`).
# `임` requires terminal punctuation; `함`/`됨` accept a bare line end. Asymmetric
# because Korean has common two-syllable Sino-Korean NOUNS ending in 임 — 위임,
# 책임, 소임 — and a bullet legitimately ends on one ("- 롤백 여부는 배포 담당자
# 책임"). Measured on real transcripts: that alone was a 0.37% false-positive rate.
# The 함 side has exactly one such family — 포함 / 미포함 / 불포함 — so it is excluded
# by lookbehind rather than by loosening the whole rule: measured at 32 line-final
# occurrences in 58,111 lines (0.055%, ~7x rarer than the 임 family), which is small
# as a rate and large as a share of POSITIVES — it produced one of the three
# violations in a 41-PR-body sample ("- [x] … — 세션 `keywords` 포함"). A bullet like
# "- 재시도 로직 변경함" is still caught. False positive (iii).
ENDING_RE = re.compile(r"(?:(?<!포)[함됨](?:[.!?](?=\s|$)|$)|임[.!?](?=\s|$))")

# The register's other recommended endings. Same sentence-final rule, so a closing
# bracket still disqualifies. Gated on POLITE_RE at the ARTIFACT level — see the
# docstring: line-level counting misfires on ordinary polite prose.
NOUN_ENDING_RE = re.compile(r"(?:필요|권장|금지|가능|위험|완료)(?:[.!?](?=\s|$)|$)")

# An artifact written in ANY uncompressed register has not been pulled into the
# compressed one, so a trailing bare noun in it is technical phrasing, not a leak.
#
# TWO registers count as uncompressed, not just 존댓말, because the corpus spans
# BOTH `## Boundaries` classes and they have different correct voices: an outbound
# draft keeps 존댓말, while a PR description or commit body is permanently excluded
# and 평서형 is its normal voice. The first live run caught the omission — a
# BASELINE PR description written entirely in 평서형 ("...통과했다.",
# "...동일하다.") ended with "확인 필요." and scored as a leak, on an arm with no
# register applied at all.
#
# Deliberately broad: a false NEGATIVE here (missing a leak) is safer than flipping
# clean prose to violated, and the 음슴체 count stays ungated either way — those
# three endings are what the register mandates and no uncompressed Korean produces.
#
# `니다` rather than an enumeration of 습니다/입니다/합니다/…: the list missed
# 드립니다 ("안내드립니다") on the first pass, and every ㅂ니다 form is polite.
POLITE_RE = re.compile(r"니다|십시오|세요|해요|에요|예요")
# 평서형: sentence-final `~다` + terminal punctuation. The register's Drop list
# names 평서형 (`~다`, `~이다`) explicitly, so finding it is positive evidence the
# text was not compressed.
#
# Two known limits, both measured and both deliberately left alone:
#   - It also matches a NOUN that happens to end in 다 ("대상은 바다."). Measured at
#     2 of 6,549 firings (0.031%) over real transcripts, and every way of tightening
#     it costs real 평서형 endings — which flips clean prose to violated, the more
#     expensive error. Left as is.
#   - A single 평서형 sentence exempts the WHOLE artifact from the noun-ending
#     count, including an outbound draft whose correct voice is 존댓말. That is
#     right for what this scorer judges — 평서형 is on the register's Drop list, so
#     its presence is evidence the text was NOT compressed — but "not compressed"
#     and "in the right voice for its class" are different axes. Rather than fold
#     the second into `violated`, `score()` reports WHICH axis granted the
#     exemption (`uncompressed_by`) so a caller that knows the artifact's class can
#     surface it separately.
PLAIN_RE = re.compile(r"[가-힣]다[.!?](?=\s|$)")
UNCOMPRESSED_RE = re.compile(POLITE_RE.pattern + "|" + PLAIN_RE.pattern)

# Lines that are structure rather than prose. A markdown heading or a table
# separator carries no sentence ending to judge.
SKIP_LINE_RE = re.compile(r"^\s*(?:#{1,6}\s|[-*+]\s*$|\|[\s|:-]+\|\s*$)")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
# Emphasis and quotation marks that can sit AFTER a sentence ending. Stripped
# before matching so `- **재시도 로직 변경함.**` still reads as an ending; a
# closing BRACKET is deliberately not in this set, since that is what makes
# `신규 2건 포함).` a noun rather than an ending (false positive (ii)).
TRAILING_DECORATION = "*_`\"'”』」»"


def split_artifact(response: str) -> tuple[str, bool, bool]:
    """Return (artifact body, start marker found, end marker found).

    A missing marker is recorded, not assumed away: a run whose prompts did not
    produce the fence is measuring something looser, and the caller prints that.
    Without the start marker the whole response is scored; without the end marker,
    everything after the start is — which is exactly how a trailing meta note gets
    counted, so the flag is what tells a reader the number is soft.
    """
    def marker_at(line: str, marker: str) -> bool:
        return line.strip().strip(MARKER_DECORATION).strip() == marker

    lines = response.splitlines(keepends=True)
    start = None
    consumed = 0
    for line in lines:
        consumed += len(line)
        if start is None:
            if marker_at(line, OUTPUT_MARKER):
                start = consumed
            continue
        if marker_at(line, END_MARKER):
            return response[start:consumed - len(line)], True, True
    if start is None:
        return response, False, False
    return response[start:], True, False


def count_endings(body: str, pattern=ENDING_RE) -> list[str]:
    """Every sentence ending matching `pattern` in `body`, as matched fragments.

    Fenced blocks are skipped as a REGION, not line by line: the register's own
    Boundaries rule keeps code verbatim, so an ending inside a fence is quoted
    code rather than the artifact's prose.
    """
    lines = body.splitlines()
    # An unclosed fence would otherwise swallow the whole rest of the artifact and
    # report zero violations — a tripwire failing silent is worse than one that
    # over-reports, so an odd fence count means the marker was decoration, not a
    # block, and nothing is skipped for it.
    balanced = sum(1 for ln in lines if FENCE_RE.match(ln)) % 2 == 0
    hits: list[str] = []
    in_fence = False
    for line in lines:
        if balanced and FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or SKIP_LINE_RE.match(line):
            continue
        stripped = line.strip()
        if stripped.startswith(">"):  # quoted source text is not the artifact
            continue
        hits.extend(m.group(0) for m in pattern.finditer(stripped.rstrip(TRAILING_DECORATION)))
    return hits


def score(response: str) -> dict:
    body, marker_found, end_found = split_artifact(response)
    hits = count_endings(body)
    # WHICH uncompressed register the artifact carries, not just whether it does.
    # An outbound draft exempted only by 평서형 is uncompressed (so no leak) while
    # still being in the wrong voice for its class — see PLAIN_RE's comment.
    if POLITE_RE.search(body):
        uncompressed_by = "polite"
    elif PLAIN_RE.search(body):
        uncompressed_by = "plain"
    else:
        uncompressed_by = None
    polite = uncompressed_by is not None
    noun_hits = [] if polite else count_endings(body, NOUN_ENDING_RE)
    return {
        "marker_found": marker_found,
        "end_marker_found": end_found,
        # True when the artifact carries an uncompressed-register marker
        # (존댓말 or 평서형). Gates the noun-ending count only.
        "polite_marker": polite,
        # Which one: "polite" (존댓말), "plain" (평서형), or None.
        "uncompressed_by": uncompressed_by,
        "violation_count": len(hits) + len(noun_hits),
        "violations": (hits + noun_hits)[:10],
        # Split out so a reader can tell a 음슴체 leak (unambiguous on its own)
        # from a noun-ending leak (counted only because no 존댓말 survived).
        "eumseum_count": len(hits),
        "noun_ending_count": len(noun_hits),
        "violated": bool(hits or noun_hits),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, help="JSONL with an `output_text` per row.")
    ap.add_argument("--output", type=Path, help="Scored JSONL. Default: stdout summary only.")
    ap.add_argument("--text-file", type=Path, help="Score a single response file instead.")
    args = ap.parse_args()

    if args.text_file:
        print(json.dumps(score(args.text_file.read_text(encoding="utf-8")),
                         ensure_ascii=False, indent=2))
        return 0
    if not args.input:
        ap.error("one of --input or --text-file is required")

    # `scored` drives the summary (probe rows only). `emitted` is the publishable
    # record: EVERY row, because the probe verdicts mean nothing without the
    # liveness / compaction / injection rows that say the run was valid. A
    # probe-only file publishes a clean number with its own validity evidence
    # stripped out.
    scored, emitted, skipped = [], [], 0
    failed: dict[str, int] = {}
    liveness: dict[str, list[dict]] = {}
    liveness_failed: dict[str, int] = {}
    # `compactions` is a per-turn RUNNING TOTAL, and probe turns are every other
    # turn, so a max taken over probe rows alone reports fewer compactions than the
    # arm actually saw (measured: runner said 1, probe-only max said 0). Collected
    # from every row, filler included.
    compaction_max: dict[str, int] = {}
    injection_max: dict[str, int] = {}
    for line in args.input.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("compactions") is not None:
            arm_key = row.get("arm", "?")
            compaction_max[arm_key] = max(compaction_max.get(arm_key, 0), row["compactions"])
        if row.get("injections") is not None:
            arm_key = row.get("arm", "?")
            injection_max[arm_key] = max(injection_max.get(arm_key, 0), row["injections"])
        # Filler turns are conversation, not a boundary artifact: a compressed
        # register SHOULD produce 음슴체 there, so counting them would report a
        # violation rate of roughly the filler share on a run where every probe
        # held. `persistence-run.py` labels each row; a file with no `kind` (e.g.
        # `iso-single.py` output) is all probes. Checked BEFORE the failure test so
        # a failed filler turn lands in the skip count rather than vanishing.
        if row.get("kind") == "liveness":
            # Scored in REVERSE, and on a DIFFERENT axis than a probe.
            #
            # The signal is the ABSENCE of an uncompressed register, not the
            # presence of an ending. Measured on a live hooked run: a compressed
            # answer to an ordinary technical question drops sentence endings
            # altogether — "부모 render 시 자식 element 재생성 → 자식도 재실행",
            # "shallow compare 자체가 없음" — so counting 음슴체/noun endings found
            # zero and called a perfectly compressed session dead. What actually
            # separates the two arms is 존댓말/평서형: the register's Drop list
            # names them, and an uncompressed answer is full of them.
            text = row.get("output_text")
            arm_key = row.get("arm", "?")
            if text and not row.get("error"):
                body, _, _ = split_artifact(text)
                compressed = not UNCOMPRESSED_RE.search(body)
                liveness.setdefault(arm_key, []).append({"compressed": compressed})
                emitted.append({**row, "liveness_compressed": compressed})
            else:
                emitted.append({**row, "liveness_compressed": None})
                # A failed liveness turn must not silently leave the denominator:
                # "2/2 compressed" out of five attempted turns is a different claim
                # from "2/2 compressed" out of two.
                liveness_failed[arm_key] = liveness_failed.get(arm_key, 0) + 1
            continue
        if row.get("kind") not in (None, "probe"):
            skipped += 1
            emitted.append(row)
            continue
        text = row.get("output_text")
        if not text or row.get("error"):
            # A failed probe has no artifact to judge, but it must stay visible:
            # an arm where 10 of 12 turns died would otherwise print a clean
            # `violations=0/2` and read as a boundary that held.
            failed[row.get("arm", "?")] = failed.get(row.get("arm", "?"), 0) + 1
            emitted.append(row)
            continue
        scored.append({**row, **score(text)})
        emitted.append(scored[-1])

    if args.output:
        with args.output.open("w", encoding="utf-8") as out:
            for row in emitted:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Per arm: a single pooled rate mixes the register under test with its own
    # baseline and reads as a middling number for both.
    arms: dict[str, list[dict]] = {arm: [] for arm in failed}
    for row in scored:
        arms.setdefault(row.get("arm", "?"), []).append(row)
    for arm, rows in arms.items():
        violations = sum(1 for r in rows if r["violated"])
        no_marker = sum(1 for r in rows if not r["marker_found"])
        no_end = sum(1 for r in rows if r["marker_found"] and not r.get("end_marker_found"))
        print(f"{arm}: violations={violations}/{len(rows)} "
              f"rows_without_output_marker={no_marker} "
              f"rows_without_end_marker={no_end} "
              f"probe_turns_failed={failed.get(arm, 0)}", file=sys.stderr)
        if no_end:
            print(f"  ^ {arm}: {no_end} row(s) have no `=== END ===` — anything the "
                  "model appended after the artifact was scored as part of it.",
                  file=sys.stderr)
        # A boundary-survival verdict means nothing if the session never compacted:
        # --autocompact only sets the window, so a short run finishes every turn
        # cleanly having tested only the pre-compaction path. Refuse the verdict
        # rather than printing a clean number nobody can qualify.
        # Register liveness gates everything else. Every probe artifact is a
        # `## Boundaries` class, so "the boundary held" and "the register was never
        # applied" produce identical probe rows — a clean violations=0 means
        # nothing until something shows the register was live. The liveness turn is
        # outside those classes, so a live register compresses it; if it did not,
        # this arm measured an uncompressed session and its number is void.
        live = liveness.get(arm)
        failed_live = liveness_failed.get(arm, 0)
        if failed_live:
            print(f"  ^ {arm}: {failed_live} liveness turn(s) failed and are not in "
                  "the counts below.", file=sys.stderr)
        if not arm.startswith("scrooge:"):
            # The baseline has no register to be live. Reporting it as "void" would
            # read as a broken run when it is the control behaving correctly.
            if live:
                compressed = sum(1 for r in live if r["compressed"])
                print(f"  ^ {arm}: baseline — {compressed}/{len(live)} liveness turns "
                      "read as compressed; uncompressed is the expected reading here, "
                      "and a compressed one only means the answer was naturally terse.",
                      file=sys.stderr)
        elif live is None:
            print(f"  ^ {arm}: no liveness turn in these rows — cannot tell whether "
                  "the register was applied at all (pre-liveness run?).", file=sys.stderr)
        else:
            compressed = sum(1 for r in live if r["compressed"])
            # A MAJORITY, not unanimity. `UNCOMPRESSED_RE` fires on 9.0% of answers
            # that are demonstrably compressed (n=1464 real ≤1500-char KO answers
            # carrying 음슴체 endings), mostly on a quoted 평서형 line. Over 5 liveness
            # turns that is a ~38% chance of at least one spurious flag, so treating
            # a single one as a mid-session lapse would void more valid runs than
            # invalid ones.
            if compressed == 0:
                print(f"  ^ {arm}: 0/{len(live)} liveness turns were compressed — the "
                      "register was NOT live in this session. The violations number "
                      "above is void, not clean.", file=sys.stderr)
            elif compressed * 2 <= len(live):
                print(f"  ^ {arm}: only {compressed}/{len(live)} liveness turns were "
                      "compressed — the register lapsed mid-session; rows after the "
                      "lapse are not boundary evidence.", file=sys.stderr)
            elif compressed < len(live):
                print(f"  ^ {arm}: {compressed}/{len(live)} liveness turns compressed — "
                      "register live; the odd turn is within the scorer's measured "
                      "9% false-fire rate, not a lapse.", file=sys.stderr)
            else:
                print(f"  ^ {arm}: register live in {compressed}/{len(live)} liveness "
                      "turns.", file=sys.stderr)
        # What the harness measured depends on how often the FULL rule went back in.
        # Every turn is a separate `--resume` process, so if the CLI raised
        # SessionStart on each one the register was re-asserted turn after turn and
        # the run says nothing about persistence. Startup + one per compaction is
        # the shape that does. Refuse the distinction silently and this harness
        # reports its own re-injection as boundary survival.
        injections = injection_max.get(arm)
        if injections is None:
            print(f"  ^ {arm}: no injection count in these rows — cannot tell whether "
                  "the register was re-asserted every turn (pre-detector run?).",
                  file=sys.stderr)
        elif injections > compaction_max.get(arm, 0) + 1:
            print(f"  ^ {arm}: {injections} full-rule injections for "
                  f"{compaction_max.get(arm, 0)} compaction(s) — the register was "
                  "re-asserted mid-session, so this measures RE-INJECTION, not "
                  "persistence.", file=sys.stderr)
        compactions = [compaction_max[arm]] if arm in compaction_max else []
        if compactions and max(compactions) == 0:
            print(f"  ^ {arm}: 0 compactions in the session — the post-compaction "
                  "path was NOT tested. This is not a boundary-survival result.",
                  file=sys.stderr)
        elif not compactions:
            print(f"  ^ {arm}: no `compactions` field in these rows — cannot tell "
                  "whether the session ever compacted (pre-detector run?).",
                  file=sys.stderr)
    print(f"scored={len(scored)} non_probe_rows_skipped={skipped}", file=sys.stderr)
    print("note: a `liveness` turn is scored in reverse — compressed is the PASS. "
          "On a baseline arm it is expected to be uncompressed.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
