// Headless smoke test: loads the built guide, visits every view, reports JS errors and overflow.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const file = 'file://' + path.resolve(process.argv[2] || 'clep-western-civilization-ii-study-guide.html');
  const shots = process.argv[3];
  const browser = await chromium.launch();
  const errors = [];
  for (const [w, h, scheme] of [[1280, 900, 'light'], [390, 844, 'dark']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w}px console: ${m.text()}`); });
    await page.goto(file);
    for (const r of ['home', 'diagnostic', 'unit-1', 'cards', 'mistakes', 'exams', 'cheatsheet', 'plan', 'about', 'settings']) {
      await page.evaluate((r) => (location.hash = r), r);
      await page.waitForTimeout(80);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) errors.push(`${w}px #${r}: horizontal overflow ${over}px`);
      if (shots) await page.screenshot({ path: `${shots}/${w}-${r}.png`, fullPage: false });
    }
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'smoke OK: no errors, no overflow');
})();
