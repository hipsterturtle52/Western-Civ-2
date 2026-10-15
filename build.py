#!/usr/bin/env python3
"""Build the single-file CLEP Western Civilization II study guide.

Reads outline.json + src/units/uNN.txt + src/app.html and writes
clep-western-civilization-ii-study-guide.html (fully self-contained).

Unit source format (sections start with '=== NAME'):
  === META       key: value lines (short, range)
  === LESSON     '## heading', paragraphs, '-> cause | event | consequence' chains
  === MUSTKNOW   '- item' lines
  === TIMELINE   'year | label | note'  (prefix '*' = include on master timeline)
  === CARDS      'front :: back'        (prefix '@ ' = person, goes on who's-who sheet)
  === QUESTIONS  blocks starting '@e' / '@m' / '@h'; stem lines ('> ' passage,
                 '|' table rows); then '+ correct :: why' and four '- wrong :: why'
                 The correct option is written first; the build assigns positions.
"""
import html
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "clep-western-civilization-ii-study-guide.html"

# Per-unit question budget, derived from the official weight midpoints
# (see outline.json). quiz = unit quiz, diag = diagnostic, exam = per practice exam.
PLAN = {
    1: dict(quiz=12, diag=2, exam=10),
    2: dict(quiz=10, diag=2, exam=6),
    3: dict(quiz=10, diag=2, exam=7),
    4: dict(quiz=12, diag=3, exam=10),
    5: dict(quiz=15, diag=4, exam=14),
    6: dict(quiz=12, diag=2, exam=10),
    7: dict(quiz=11, diag=2, exam=8),
    8: dict(quiz=13, diag=3, exam=11),
    9: dict(quiz=12, diag=2, exam=10),
    10: dict(quiz=15, diag=3, exam=13),
    11: dict(quiz=12, diag=2, exam=10),
    12: dict(quiz=13, diag=3, exam=11),
}
# Total planned study hours for unit work (lesson x2, quiz + review, flashcards),
# split by weight. Diagnostic, exams and final review are added in the app.
UNIT_HOURS_TOTAL = 21.0


def inline(text):
    """Escape, then apply **bold** and *italic*."""
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", t)
    return t


def split_sections(text):
    sections, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^===\s*([A-Z]+)\s*$", line)
        if m:
            cur = m.group(1)
            sections[cur] = []
        elif cur:
            sections[cur].append(line.rstrip())
    return sections


def render_lesson(lines):
    out, para = [], []

    def flush():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    words = 0
    for line in lines:
        s = line.strip()
        if not s:
            flush()
            continue
        words += len(re.findall(r"\S+", s))
        if s.startswith("## "):
            flush()
            out.append("<h3>" + inline(s[3:]) + "</h3>")
        elif s.startswith("-> "):
            flush()
            parts = [p.strip() for p in s[3:].split("|")]
            assert len(parts) == 3, f"chain needs 3 parts: {s}"
            labels = ["Cause", "Event", "Consequence"]
            cells = "".join(
                f'<div class="chain-step"><span class="chain-label">{labels[i]}</span>{inline(p)}</div>'
                for i, p in enumerate(parts)
            )
            out.append(f'<div class="chain" role="group" aria-label="Cause, event, consequence">{cells}</div>')
        else:
            para.append(s)
    flush()
    return "\n".join(out), words


def render_stem(lines):
    out, table, plain = [], [], []

    def flush_table():
        if table:
            rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in table]
            head = "".join(f"<th>{inline(c)}</th>" for c in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f'<div class="tablewrap"><table class="qtable"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            table.clear()

    quote = []

    def flush_quote():
        if quote:
            out.append("<blockquote>" + "<br>".join(inline(q) for q in quote) + "</blockquote>")
            quote.clear()

    for line in lines:
        s = line.strip()
        if s.startswith("|"):
            flush_quote()
            table.append(s)
        elif s.startswith(">"):
            flush_table()
            quote.append(s[1:].strip())
        elif s:
            flush_table()
            flush_quote()
            out.append("<p>" + inline(s) + "</p>")
            plain.append(s)
    flush_table()
    flush_quote()
    return "".join(out)


def parse_questions(lines, unit):
    qs, cur = [], None
    for raw in lines:
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^@([emh])\s*$", s)
        if m:
            cur = {"diff": m.group(1), "stem": [], "opts": []}
            qs.append(cur)
            continue
        if cur is None:
            raise ValueError(f"unit {unit}: text before first question: {s}")
        if s[:2] in ("+ ", "- "):
            body, _, why = s[2:].partition(" :: ")
            if not why:
                raise ValueError(f"unit {unit}: option missing ' :: ' explanation: {s}")
            cur["opts"].append({"ok": s[0] == "+", "text": body.strip(), "why": why.strip()})
        else:
            if cur["opts"]:
                raise ValueError(f"unit {unit}: stem text after options: {s}")
            cur["stem"].append(s)
    return qs


def parse_unit(path, topic):
    sec = split_sections(path.read_text(encoding="utf-8"))
    meta = {}
    for line in sec.get("META", []):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    uid = topic["id"]
    lesson_html, words = render_lesson(sec.get("LESSON", []))
    must = [inline(l.strip()[2:]) for l in sec.get("MUSTKNOW", []) if l.strip().startswith("- ")]
    timeline = []
    for l in sec.get("TIMELINE", []):
        s = l.strip()
        if not s:
            continue
        key = s.startswith("*")
        parts = [p.strip() for p in s.lstrip("*").split("|")]
        assert len(parts) == 3, f"timeline row needs 3 parts: {s}"
        timeline.append({"y": parts[0], "label": inline(parts[1]), "note": inline(parts[2]), "key": key})
    cards = []
    for l in sec.get("CARDS", []):
        s = l.strip()
        if not s:
            continue
        person = s.startswith("@ ")
        s = s[2:] if person else s
        front, _, back = s.partition(" :: ")
        assert back, f"card missing ' :: ': {s}"
        cards.append({"id": f"u{uid}c{len(cards) + 1}", "front": inline(front.strip()), "back": inline(back.strip()), "person": person})
    qs = parse_questions(sec.get("QUESTIONS", []), uid)
    return {
        "id": uid,
        "title": topic["title"],
        "short": meta.get("short", topic["title"]),
        "range": meta.get("range", ""),
        "weight": {"min": topic["min"], "max": topic["max"], "verified": topic["verified"]},
        "subtopics": topic["subtopics"],
        "lesson": lesson_html,
        "words": words,
        "minutes": max(8, round(words / 140)),
        "mustKnow": must,
        "timeline": timeline,
        "cards": cards,
    }, qs


def assign_pools(uid, qs, rng):
    plan = PLAN[uid]
    targets = {"diag": plan["diag"], "exam1": plan["exam"], "exam2": plan["exam"], "quiz": plan["quiz"]}
    need = sum(targets.values())
    if len(qs) != need:
        raise ValueError(f"unit {uid}: has {len(qs)} questions, plan needs {need}")
    # Deal each difficulty level across pools so every pool gets a similar mix.
    counts = {k: 0 for k in targets}
    order = sorted(range(len(qs)), key=lambda i: ("emh".index(qs[i]["diff"]), rng.random()))
    for i in order:
        # Pool with the lowest fill ratio that still has room.
        pool = min((k for k in targets if counts[k] < targets[k]), key=lambda k: (counts[k] / targets[k], k))
        qs[i]["pool"] = pool
        counts[pool] += 1
    return qs


def finalize_questions(all_qs, rng):
    """Assign balanced correct-answer positions per pool and shuffle distractors."""
    by_pool = {}
    for q in all_qs:
        by_pool.setdefault(q["pool"], []).append(q)
    for pool, qs in by_pool.items():
        positions = [i % 5 for i in range(len(qs))]
        rng.shuffle(positions)
        for q, pos in zip(qs, positions):
            correct = [o for o in q["opts"] if o["ok"]]
            wrong = [o for o in q["opts"] if not o["ok"]]
            rng.shuffle(wrong)
            opts = wrong[:pos] + correct + wrong[pos:]
            q["options"] = [inline(o["text"]) for o in opts]
            q["why"] = [inline(o["why"]) for o in opts]
            q["answer"] = pos
    return by_pool


def validate(q, uid):
    errs = []
    if len(q["opts"]) != 5:
        errs.append(f"{len(q['opts'])} options")
    if sum(o["ok"] for o in q["opts"]) != 1:
        errs.append("needs exactly one '+' option")
    texts = [o["text"].lower() for o in q["opts"]]
    if len(set(texts)) != len(texts):
        errs.append("duplicate option text")
    if any(re.search(r"\b(all|none) of the above\b", t) for t in texts):
        errs.append("'all/none of the above' option")
    if not q["stem"]:
        errs.append("empty stem")
    if errs:
        raise ValueError(f"unit {uid} question '{' '.join(q['stem'])[:70]}': " + "; ".join(errs))


def main():
    outline = json.loads((ROOT / "outline.json").read_text(encoding="utf-8"))
    rng = random.Random(1648)
    units, questions = [], []
    for topic in outline["topics"]:
        path = ROOT / "src" / "units" / f"u{topic['id']:02d}.txt"
        if not path.exists():
            continue
        unit, qs = parse_unit(path, topic)
        for q in qs:
            validate(q, unit["id"])
        if qs:
            assign_pools(unit["id"], qs, rng)
        for n, q in enumerate(qs, 1):
            q["unit"] = unit["id"]
            q["id"] = f"u{unit['id']}q{n}"
        units.append(unit)
        questions.extend(qs)

    finalize_questions(questions, rng)

    mids = {t["id"]: (t["min"] + t["max"]) / 2 for t in outline["topics"]}
    total_mid = sum(mids.values())
    for u in units:
        u["hours"] = round(UNIT_HOURS_TOTAL * mids[u["id"]] / total_mid, 2)
        u["quizIds"] = [q["id"] for q in questions if q["unit"] == u["id"] and q["pool"] == "quiz"]

    qmap = {}
    for q in questions:
        qmap[q["id"]] = {
            "id": q["id"], "unit": q["unit"], "diff": q["diff"], "pool": q["pool"],
            "stem": render_stem(q["stem"]), "options": q["options"], "why": q["why"], "answer": q["answer"],
        }
    pools = {p: [q["id"] for q in questions if q["pool"] == p] for p in ("diag", "exam1", "exam2")}
    for p in pools:
        rng.shuffle(pools[p])

    data = {
        "meta": {
            "exam": outline["exam"],
            "format": outline["format"],
            "sources": outline["sources"],
            "verificationNote": outline["verification_note"],
            "skills": outline["skills_tested"],
        },
        "outline": outline["topics"],
        "units": units,
        "questions": qmap,
        "pools": pools,
    }
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = (ROOT / "src" / "app.html").read_text(encoding="utf-8")
    page = template.replace("/*__DATA__*/null", payload)
    OUT.write_text(page, encoding="utf-8")

    # Artifact variant: the publisher supplies <!doctype>, <html>, <head>, <body>.
    if "--artifact" in sys.argv:
        dest = Path(sys.argv[sys.argv.index("--artifact") + 1])
        body = page
        body = re.sub(r"(?is)<!doctype html>\s*", "", body)
        body = re.sub(r"(?is)</?html[^>]*>\s*", "", body)
        body = re.sub(r"(?is)</?head>\s*", "", body)
        body = re.sub(r"(?is)</?body[^>]*>\s*", "", body)
        body = re.sub(r'(?is)<meta charset="utf-8">\s*', "", body)
        body = re.sub(r'(?is)<meta name="viewport"[^>]*>\s*', "", body)
        dest.write_text(body, encoding="utf-8")

    print(f"wrote {OUT.name}: {len(units)} units, {len(questions)} questions, "
          f"{sum(len(u['cards']) for u in units)} cards, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
