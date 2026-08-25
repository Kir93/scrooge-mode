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
    Korean from 33.5% to 45.9%. So they count only when the artifact carries NO
    존댓말 marker anywhere — which is the property actually under test ("did this
    lose its polite register?"), measured at 70.2% recall against 6.4% false
    positives.

Two false positives showed up the first time this was scored by hand, and both
are pinned by `test_persistence_score.py`:

  (i)  The model keeps the boundary and then REPORTS that it did, in the
       compressed register: "PR 설명은 압축 제외 - 평문으로 작성함." That
       sentence is conversation about the artifact, not the artifact. Scoring
       the whole response counts it as a violation and inverts the result. So a
       response is split on an OUTPUT marker the corpus prompts ask for, and
       only what follows it is scored.
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
ENDING_RE = re.compile(r"[함됨임](?:[.!?](?=\s|$)|$)")

# The register's other recommended endings. Same sentence-final rule, so a closing
# bracket still disqualifies. Gated on POLITE_RE at the ARTIFACT level — see the
# docstring: line-level counting misfires on ordinary polite prose.
NOUN_ENDING_RE = re.compile(r"(?:필요|권장|금지|가능|위험|완료)(?:[.!?](?=\s|$)|$)")

# Any 존댓말 marker anywhere in the artifact means the polite register survived, so
# a trailing bare noun there is technical phrasing, not a leak. Deliberately broad:
# a false NEGATIVE here (missing a leak) is safer than flipping a clean polite
# draft to violated, and the 음슴체 count stays ungated regardless.
# `니다` rather than an enumeration of 습니다/입니다/합니다/…: the list missed
# 드립니다 ("안내드립니다") on the first pass, and every ㅂ니다 form is polite.
POLITE_RE = re.compile(r"니다|십시오|세요|해요|에요|예요")

# Lines that are structure rather than prose. A markdown heading or a table
# separator carries no sentence ending to judge.
SKIP_LINE_RE = re.compile(r"^\s*(?:#{1,6}\s|[-*+]\s*$|\|[\s|:-]+\|\s*$)")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
# Emphasis and quotation marks that can sit AFTER a sentence ending. Stripped
# before matching so `- **재시도 로직 변경함.**` still reads as an ending; a
# closing BRACKET is deliberately not in this set, since that is what makes
# `신규 2건 포함).` a noun rather than an ending (false positive (ii)).
TRAILING_DECORATION = "*_`\"'”』」»"


def split_artifact(response: str) -> tuple[str, bool]:
    """Return (artifact body, whether the marker was found).

    Without the marker the whole response is scored, and the caller records that
    — a run whose prompts did not produce the marker is measuring something
    looser, and that should be visible in the data rather than assumed away.
    """
    lines = response.splitlines(keepends=True)
    consumed = 0
    for line in lines:
        consumed += len(line)
        if line.strip().strip(MARKER_DECORATION).strip() == OUTPUT_MARKER:
            return response[consumed:], True
    return response, False


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
    body, marker_found = split_artifact(response)
    hits = count_endings(body)
    polite = bool(POLITE_RE.search(body))
    noun_hits = [] if polite else count_endings(body, NOUN_ENDING_RE)
    return {
        "marker_found": marker_found,
        "polite_marker": polite,
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

    scored, skipped = [], 0
    failed: dict[str, int] = {}
    for line in args.input.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        # Filler turns are conversation, not a boundary artifact: a compressed
        # register SHOULD produce 음슴체 there, so counting them would report a
        # violation rate of roughly the filler share on a run where every probe
        # held. `persistence-run.py` labels each row; a file with no `kind` (e.g.
        # `iso-single.py` output) is all probes. Checked BEFORE the failure test so
        # a failed filler turn lands in the skip count rather than vanishing.
        if row.get("kind") not in (None, "probe"):
            skipped += 1
            continue
        text = row.get("output_text")
        if not text or row.get("error"):
            # A failed probe has no artifact to judge, but it must stay visible:
            # an arm where 10 of 12 turns died would otherwise print a clean
            # `violations=0/2` and read as a boundary that held.
            failed[row.get("arm", "?")] = failed.get(row.get("arm", "?"), 0) + 1
            continue
        scored.append({**row, **score(text)})

    if args.output:
        with args.output.open("w", encoding="utf-8") as out:
            for row in scored:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Per arm: a single pooled rate mixes the register under test with its own
    # baseline and reads as a middling number for both.
    arms: dict[str, list[dict]] = {arm: [] for arm in failed}
    for row in scored:
        arms.setdefault(row.get("arm", "?"), []).append(row)
    for arm, rows in arms.items():
        violations = sum(1 for r in rows if r["violated"])
        no_marker = sum(1 for r in rows if not r["marker_found"])
        print(f"{arm}: violations={violations}/{len(rows)} "
              f"rows_without_output_marker={no_marker} "
              f"probe_turns_failed={failed.get(arm, 0)}", file=sys.stderr)
        # A boundary-survival verdict means nothing if the session never compacted:
        # --autocompact only sets the window, so a short run finishes every turn
        # cleanly having tested only the pre-compaction path. Refuse the verdict
        # rather than printing a clean number nobody can qualify.
        compactions = [r.get("compactions") for r in rows if r.get("compactions") is not None]
        if compactions and max(compactions) == 0:
            print(f"  ^ {arm}: 0 compactions in the session — the post-compaction "
                  "path was NOT tested. This is not a boundary-survival result.",
                  file=sys.stderr)
        elif not compactions:
            print(f"  ^ {arm}: no `compactions` field in these rows — cannot tell "
                  "whether the session ever compacted (pre-detector run?).",
                  file=sys.stderr)
    print(f"scored={len(scored)} non_probe_rows_skipped={skipped}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
