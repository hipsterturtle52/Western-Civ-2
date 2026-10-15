// Self-audit for the study guide.
// 1) Static checks on the embedded question bank.
// 2) Drives the real page in headless Chromium: diagnostic, Practice Exam 1, a unit quiz,
//    flashcards, study plan, export/import, blocked storage and exam time-out.
// Usage: NODE_PATH=$(npm root -g) node tools/audit.js [file] [screenshotDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'clep-western-civilization-ii-study-guide.html');
const shots = process.argv[3];
const html = fs.readFileSync(file, 'utf8');
const DATA = JSON.parse(html.match(/const DATA = (\{.*?\});\n/s)[1].replace(/<\\\//g, '</'));
const outline = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'outline.json'), 'utf8'));

let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const strip = (s) => s.replace(/<[^>]+>/g, '').trim();

// ---------- static checks ----------
console.log('STATIC CHECKS');
const Q = DATA.questions, ids = Object.keys(Q);
const unitIds = new Set(DATA.units.map((u) => u.id));
let bad = 0;
const stems = new Map();
for (const id of ids) {
  const q = Q[id];
  const errs = [];
  if (!unitIds.has(q.unit)) errs.push('bad unit tag');
  if (!Array.isArray(q.options) || q.options.length !== 5) errs.push('not 5 options');
  if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 5)) errs.push('answer index out of range');
  if (!Array.isArray(q.why) || q.why.length !== 5 || q.why.some((w) => strip(w).length < 10)) errs.push('missing explanation');
  if (new Set(q.options.map((o) => strip(o).toLowerCase())).size !== 5) errs.push('duplicate options');
  if (q.options.some((o) => /\b(all|none) of the above\b/i.test(o))) errs.push('all/none of the above');
  if (!['e', 'm', 'h'].includes(q.diff)) errs.push('bad difficulty');
  if (!['quiz', 'diag', 'exam1', 'exam2'].includes(q.pool)) errs.push('bad pool');
  const s = strip(q.stem).toLowerCase();
  if (stems.has(s)) errs.push('duplicate stem with ' + stems.get(s));
  stems.set(s, id);
  if (errs.length) { bad++; fail(`${id}: ${errs.join(', ')}`); }
}
if (!bad) ok(`${ids.length} questions: each has 5 options, exactly one answer key, 5 explanations, a valid unit tag, no duplicates`);

const pools = { quiz: [], diag: DATA.pools.diag, exam1: DATA.pools.exam1, exam2: DATA.pools.exam2 };
pools.quiz = ids.filter((id) => Q[id].pool === 'quiz');
const seen = new Map();
for (const [p, list] of Object.entries(pools)) for (const id of list) {
  if (seen.has(id)) fail(`${id} appears in both ${seen.get(id)} and ${p}`);
  seen.set(id, p);
}
if (seen.size === ids.length) ok('pools are disjoint: no question repeats between quizzes, diagnostic, Exam 1 and Exam 2');
DATA.pools.exam1.length === DATA.meta.format.questions && DATA.pools.exam2.length === DATA.meta.format.questions
  ? ok(`each practice exam has ${DATA.meta.format.questions} questions (official count)`) : fail('exam length mismatch');
DATA.pools.diag.length === 30 ? ok('diagnostic has 30 questions') : fail('diagnostic length');

const posDist = (list) => { const c = [0, 0, 0, 0, 0]; list.forEach((id) => c[Q[id].answer]++); return c; };
const diffDist = (list) => { const c = { e: 0, m: 0, h: 0 }; list.forEach((id) => c[Q[id].diff]++); return c; };
for (const [p, list] of Object.entries(pools)) {
  const c = posDist(list), d = diffDist(list), n = list.length;
  const spread = Math.max(...c) - Math.min(...c);
  (spread <= 1 ? ok : fail)(`${p}: answer positions A-E ${c.join('/')}, difficulty easy/med/hard ${Math.round(100 * d.e / n)}/${Math.round(100 * d.m / n)}/${Math.round(100 * d.h / n)}%`);
}
const allPos = posDist(ids), allDiff = diffDist(ids);
ok(`whole bank: positions ${allPos.join('/')}; difficulty ${Math.round(100 * allDiff.e / ids.length)}% easy, ${Math.round(100 * allDiff.m / ids.length)}% medium, ${Math.round(100 * allDiff.h / ids.length)}% hard (target 30/50/20)`);
let longest = 0;
for (const id of ids) { const L = Q[id].options.map((o) => strip(o).length); if (L[Q[id].answer] === Math.max(...L)) longest++; }
ok(`correct answer is the longest option in ${Math.round(100 * longest / ids.length)}% of questions (chance = 20%)`);

// coverage table vs official weights
const mid = (t) => (t.min + t.max) / 2;
const totMid = outline.topics.reduce((s, t) => s + mid(t), 0);
const totWords = DATA.units.reduce((s, u) => s + u.words, 0);
const totCards = DATA.units.reduce((s, u) => s + u.cards.length, 0);
const rows = [];
for (const t of outline.topics) {
  const u = DATA.units.find((x) => x.id === t.id);
  const qn = ids.filter((id) => Q[id].unit === t.id).length;
  const e1 = DATA.pools.exam1.filter((id) => Q[id].unit === t.id).length;
  rows.push({ id: t.id, weight: `${t.min}-${t.max}%${t.verified ? '' : '*'}`, wShare: (100 * mid(t) / totMid).toFixed(1),
    lessonMin: u.minutes, lessonShare: (100 * u.words / totWords).toFixed(1), q: qn, qShare: (100 * qn / ids.length).toFixed(1),
    quiz: u.quizIds.length, exam: e1, cards: u.cards.length, cShare: (100 * u.cards.length / totCards).toFixed(1) });
}

// ---------- browser run ----------
(async () => {
  console.log('\nBROWSER RUN');
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file);
  const go = async (h) => { await page.evaluate((h) => (location.hash = h), h); await page.waitForTimeout(60); };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('clep-wc2-guide-v1') || '{}'));

  // Diagnostic: answer via keyboard. Right on even questions, wrong on odd ones.
  await go('diagnostic');
  await page.click('[data-act="diag-start"]');
  const diagIds = DATA.pools.diag;
  let expectRight = 0; const expectBy = {};
  for (let i = 0; i < diagIds.length; i++) {
    const q = Q[diagIds[i]];
    const shown = strip(await page.innerHTML('.stem'));
    if (shown !== strip(q.stem)) { fail(`diagnostic Q${i + 1} shows a different question than expected`); break; }
    const right = i % 2 === 0;
    const choice = right ? q.answer : (q.answer + 1) % 5;
    await page.keyboard.press(String(choice + 1));
    await page.keyboard.press('Enter');
    expectBy[q.unit] = expectBy[q.unit] || [0, 0]; expectBy[q.unit][1]++;
    if (right) { expectRight++; expectBy[q.unit][0]++; }
  }
  await page.waitForTimeout(100);
  let st = await state();
  if (st.diag && st.diag.score === expectRight && st.diag.total === 30) ok(`diagnostic completed by keyboard: scored ${st.diag.score}/30 as expected`);
  else fail(`diagnostic score ${st.diag && st.diag.score} != ${expectRight}`);
  const byOk = Object.keys(expectBy).every((u) => JSON.stringify(st.diag.byUnit[u]) === JSON.stringify(expectBy[u]));
  byOk ? ok('diagnostic per-unit scores match the answer key') : fail('diagnostic per-unit mismatch');
  const recChips = await page.$$eval('table tbody tr', (r) => r.length);
  recChips === Object.keys(expectBy).length ? ok(`diagnostic results show ${recChips} unit rows with Skim/Review/Must-study marks`) : fail('diagnostic unit rows');
  const openMist = Object.values(st.mistakes).filter((m) => !m.cleared).length;
  openMist === 30 - expectRight ? ok(`mistake log received all ${openMist} missed diagnostic questions`) : fail(`mistake log ${openMist}`);
  if (shots) await page.screenshot({ path: `${shots}/audit-diagnostic.png`, fullPage: false });

  // Practice Exam 1: 120 questions, clock running, answered by keyboard; 96 right (80%).
  await go('exams');
  await page.click('[data-act="exam-start"][data-k="exam1"]');
  await page.click('[data-act="exam-go"][data-k="exam1"]');
  await page.waitForTimeout(1200);
  const timerTxt = await page.textContent('#timer');
  /^(89|90):\d\d$/.test(timerTxt) ? ok(`exam timer running (${timerTxt} left of 90:00)`) : fail('timer text ' + timerTxt);
  const exIds = DATA.pools.exam1; let exRight = 0;
  for (let i = 0; i < exIds.length; i++) {
    const q = Q[exIds[i]];
    const right = i % 5 !== 0;
    await page.keyboard.press(String((right ? q.answer : (q.answer + 2) % 5) + 1));
    if (right) exRight++;
    if (i < exIds.length - 1) await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Enter'); // last question: review & submit
  await page.waitForTimeout(150);
  st = await state();
  const e = st.exams.exam1;
  if (e && e.status === 'done' && e.score === exRight && e.total === 120) ok(`Practice Exam 1 submitted: ${e.score}/120 (${Math.round(100 * e.score / 120)}%) as expected`);
  else fail(`exam1 result ${JSON.stringify(e && { s: e.status, score: e.score })}`);
  const topicRows = await page.$$eval('table tbody tr', (r) => r.length);
  topicRows === 12 ? ok('exam results show all 12 topics') : fail(`exam topic rows ${topicRows}`);
  if (shots) await page.screenshot({ path: `${shots}/audit-exam-results.png`, fullPage: false });
  await go('home');
  const badge = await page.textContent('.ready-badge');
  badge.includes('Not ready') ? ok('readiness stays "Not ready yet" with only one exam at 80%') : fail('readiness badge ' + badge);

  // Unit quiz with immediate feedback
  await go('unit-5');
  await page.click('[data-act="unit-quiz"]');
  await page.keyboard.press('1');
  const whyCount = await page.$$eval('.why li', (l) => l.length);
  whyCount === 5 ? ok('unit quiz shows a verdict and an explanation for all 5 options after answering') : fail('why count ' + whyCount);
  if (shots) await page.screenshot({ path: `${shots}/audit-quiz-feedback.png`, fullPage: false });
  const n5 = DATA.units.find((u) => u.id === 5).quizIds.length;
  for (let i = 1; i < n5; i++) { await page.keyboard.press('Enter'); await page.keyboard.press('2'); }
  await page.keyboard.press('Enter');
  st = await state();
  st.units['5'] && st.units['5'].quiz.length === 1 ? ok(`unit 5 quiz recorded (${st.units['5'].quiz[0].score}/${n5})`) : fail('unit quiz not recorded');

  // Flashcards: Leitner
  await go('cards');
  await page.click('[data-act="cards-due"]');
  await page.keyboard.press(' '); await page.keyboard.press('2');
  await page.keyboard.press(' '); await page.keyboard.press('1');
  st = await state();
  const boxes = Object.values(st.cards).map((c) => c.box).sort();
  JSON.stringify(boxes) === '[1,2]' ? ok('Leitner: known card moved to box 2, missed card to box 1') : fail('boxes ' + boxes);
  await page.click('[data-act="cards-quit"]');
  const missedBtn = await page.textContent('[data-act="cards-missed"]');
  missedBtn.includes('(1)') ? ok('"Review missed only" offers exactly the 1 missed card') : fail('missed button ' + missedBtn);

  // Study plan
  await go('plan');
  const start = new Date(); const exam = new Date(Date.now() + 14 * 864e5);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  await page.fill('#planHours', '2.5'); await page.dispatchEvent('#planHours', 'change');
  await page.fill('#planStart', iso(start)); await page.dispatchEvent('#planStart', 'change');
  await page.fill('#planDate', iso(exam)); await page.dispatchEvent('#planDate', 'change');
  const planRows = await page.$$eval('.plan-table tbody tr', (r) => r.map((x) => x.textContent));
  const last3 = planRows.slice(-3);
  planRows.length === 15 && /Practice Exam 1/.test(last3[0]) && /Practice Exam 2/.test(last3[1]) && /exam day/i.test(last3[2])
    ? ok('study plan: 14 days + exam day; Practice Exam 1 and 2 fall on the 2 days before the exam') : fail('plan rows ' + planRows.length);
  if (shots) await page.screenshot({ path: `${shots}/audit-plan.png`, fullPage: false });

  // Export / reset / import round trip
  await go('settings');
  const exported = await page.inputValue('#exportBox');
  await page.click('[data-act="reset"]'); await page.click('[data-act="reset-confirm"]');
  st = await state();
  !st.diag ? ok('reset clears progress') : fail('reset');
  await go('settings');
  await page.fill('#importBox', exported); await page.click('[data-act="import-text"]');
  st = await state();
  st.diag && st.exams.exam1 && st.exams.exam1.score === exRight ? ok('import restores exported progress exactly') : fail('import');

  // Readiness: both exams at 75%+ lights "Ready to book"
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('clep-wc2-guide-v1'));
    s.exams.exam2 = { status: 'done', start: Date.now() - 3e6, end: Date.now(), ids: [], answers: {}, flags: {}, score: 90, total: 120, byUnit: {} };
    localStorage.setItem('clep-wc2-guide-v1', JSON.stringify(s));
  });
  await page.reload(); await go('home');
  const badge2 = await page.textContent('.ready-badge');
  badge2.includes('Ready to book') ? ok('readiness shows "Ready to book" once both exams are at 75% or higher (80%, 75%)') : fail('ready badge ' + badge2);

  // Exam time-out while away: auto-submit on load
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('clep-wc2-guide-v1'));
    s.exams.exam2 = { status: 'running', start: Date.now() - 91 * 60000, ids: [], answers: {}, flags: {}, idx: 0 };
    localStorage.setItem('clep-wc2-guide-v1', JSON.stringify(s));
  });
  await page.evaluate((ids) => {
    const s = JSON.parse(localStorage.getItem('clep-wc2-guide-v1')); s.exams.exam2.ids = ids;
    localStorage.setItem('clep-wc2-guide-v1', JSON.stringify(s));
  }, DATA.pools.exam2);
  await page.reload(); await page.waitForTimeout(200);
  st = await state();
  st.exams.exam2.status === 'done' && st.exams.exam2.score === 0 ? ok('expired exam is auto-submitted on reload (no pausing)') : fail('timeout ' + st.exams.exam2.status);
  await ctx.close();

  // Storage blocked
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto('file://' + file);
  await p2.evaluate(() => (location.hash = 'unit-1')); await p2.waitForTimeout(60);
  await p2.click('[data-act="mark-read"]');
  const note = await p2.textContent('main');
  !errs2.length && /blocking saved progress/.test(note) ? ok('with storage blocked: no errors, app works, warning shown') : fail('blocked storage ' + errs2.join(';'));
  await ctx2.close();
  await browser.close();

  errors.length ? fail('page errors: ' + errors.join(' | ')) : ok('no JavaScript errors during the run');

  console.log('\nCOVERAGE VS OFFICIAL WEIGHTS (* = weight unverified)');
  console.log('unit | weight  | wt share | lesson min | lesson share | questions (share) | quiz | per exam | cards (share)');
  for (const r of rows) console.log(`${String(r.id).padStart(4)} | ${r.weight.padEnd(7)} | ${r.wShare.padStart(7)}% | ${String(r.lessonMin).padStart(10)} | ${r.lessonShare.padStart(11)}% | ${String(r.q).padStart(9)} (${r.qShare}%) | ${String(r.quiz).padStart(4)} | ${String(r.exam).padStart(8)} | ${String(r.cards).padStart(5)} (${r.cShare}%)`);
  console.log(`TOTAL: ${DATA.units.length} lessons (${DATA.units.reduce((s, u) => s + u.minutes, 0)} min), ${ids.length} questions, ${totCards} flashcards`);
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAUDIT PASSED');
  process.exit(failures ? 1 : 0);
})();
