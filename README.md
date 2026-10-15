# CLEP Western Civilization II study guide

`clep-western-civilization-ii-study-guide.html` is the deliverable: one self-contained file, no
dependencies, works offline. Open it in any browser. Progress is saved in the browser's
localStorage (export/import as JSON under **Progress & settings**).

## Sources
- `outline.json`: official exam format and content outline with weights, from the College Board
  exam page and fact sheet (URLs inside; see `verification_note` for what could not be confirmed).
- `src/units/uNN.txt`: lesson, must-know box, timeline, flashcards and question bank per unit.
- `src/app.html`: the app (HTML/CSS/JS); `build.py` embeds the content into it.

## Rebuild and audit
```
python3 build.py                                   # writes the HTML file
NODE_PATH=$(npm root -g) node tools/audit.js       # static checks + scripted browser run
NODE_PATH=$(npm root -g) node tools/smoke.js       # every view, both widths, no JS errors/overflow
```
`audit-report.txt` holds the latest audit output, including coverage versus official weights.
