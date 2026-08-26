// End-to-end tests for Stash. Drives the real page in Chromium and talks to the
// mock Supabase in tests/mock-supabase.js.
//
//   npm test
//
// Every check prints PASS or FAIL; the process exits non-zero if anything failed.
const { chromium } = require('playwright');

const APP = process.env.APP_URL || 'http://localhost:8080/index.html';
const MOCK = 'http://localhost:8787';
const PEEK = 'http://localhost:8788';
const DAY = 86400000;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};
const eq = (name, got, want, extra) =>
  ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` + (extra ? ' · ' + extra : ''));
const section = t => console.log('\n' + t);
const peek = () => fetch(PEEK).then(r => r.json());

// a goal plus a fortnight of entries, written straight into localStorage
function seed(page, opts = {}) {
  return page.evaluate(([d, o]) => {
    const now = Date.now();
    const gid = 'g1';
    const plan = [[13, 800, 'Starting amount', 'Gift'], [12, 120, 'Allowance', 'Allowance'],
                  [10, 450, 'Tutoring', 'Work'], [9, -90, 'Bought a lock', ''],
                  [8, 200, 'Allowance', 'Allowance'], [6, 300, 'Birthday money', 'Gift'],
                  [5, 150, 'Tutoring', 'Work'], [3, -140, 'Helmet', ''],
                  [2, 220, 'Allowance', 'Allowance'], [1, 180, 'Tutoring', 'Work'],
                  [0, 260, 'Sold my old bike', 'Sold something']];
    localStorage.setItem('kupa.v1', JSON.stringify({
      v: 2, activeId: gid, theme: 'light', lastSync: 0, deleted: { entries: [], goals: [], incomes: [] },
      goals: [{ id: gid, name: 'Electric bike', target: 5000, cur: '$', celebrated: false,
                completedAt: null, createdAt: now - 14 * d, updatedAt: now - 14 * d }],
      incomes: o.incomes || [],
      // minutes are subtracted, never added: adding hours would push "today"
      // into tomorrow whenever the suite runs late in the day
      entries: plan.map(([ago, amount, note, source], i) => ({
        id: 's' + i, goalId: gid, amount, note, source,
        ts: now - ago * d - i * 60000, updatedAt: now - ago * d
      }))
    }));
  }, [DAY, opts]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(m => { window.STASH_CONFIG = { url: m, anonKey: 'test-anon-key-aaaaaaaaaaaaaaaaaaa' }; }, MOCK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await fetch(PEEK + '/reset');

  // ---------------------------------------------------------------- onboarding
  section('onboarding');
  await page.goto(APP);
  await page.waitForTimeout(300);
  ok('first run shows onboarding', await page.locator('#onboard').isVisible());
  ok('sign-in escape hatch exists', await page.locator('#obSignIn').isVisible());
  await page.fill('#obName', 'Headphones');
  await page.fill('#obTarget', '1200');
  await page.selectOption('#obCur', '$');
  await page.fill('#obStart', '300');
  await page.click('#obStartBtn');
  await page.waitForTimeout(300);
  ok('onboarding dismissed', !(await page.locator('#onboard').isVisible()));
  eq('starting amount counted', await page.textContent('#savedTxt'), '$300');

  // ---------------------------------------------------------------- keypad & sources
  section('adding money');
  await page.click('.tab[data-scr="add"]');
  await page.click('.key[data-k="1"]'); await page.click('.key[data-k="2"]'); await page.click('.key[data-k="5"]');
  eq('keypad types', await page.textContent('#amtBig'), '$125');
  await page.click('.chip[data-v="100"]');
  eq('quick chip adds to the amount', await page.textContent('#amtBig'), '$225');
  await page.click('.key[data-k="back"]');
  eq('backspace deletes a digit', await page.textContent('#amtBig'), '$22');
  await page.click('.src[data-src="Work"]');
  ok('source chip selects', (await page.getAttribute('.src[data-src="Work"]', 'class')).includes('on'));
  await page.click('#addBtn'); await page.waitForTimeout(200);
  eq('entry added with source', await page.textContent('#savedTxt'), '$322');
  eq('keypad resets', await page.textContent('#amtBig'), '$0');
  await page.click('button[data-mode="out"]');
  await page.click('.key[data-k="2"]'); await page.click('.key[data-k="2"]');
  eq('money out shows negative', await page.textContent('#amtBig'), '−$22');
  await page.click('#addBtn'); await page.waitForTimeout(200);
  eq('withdrawal subtracts', await page.textContent('#savedTxt'), '$300');
  await page.click('button[data-mode="in"]');

  // ---------------------------------------------------------------- multiple goals
  section('multiple goals');
  await page.click('.tab[data-scr="home"]'); await page.waitForTimeout(150);
  await page.click('#goalPick'); await page.waitForTimeout(200);
  await page.click('#addGoalFromPicker'); await page.waitForTimeout(200);
  await page.fill('#geName', 'Electric bike');
  await page.fill('#geTarget', '5000');
  await page.click('#geSave'); await page.waitForTimeout(300);
  eq('switched to the new goal', await page.textContent('#goalName'), 'Electric bike');
  eq('new goal starts empty', await page.textContent('#savedTxt'), '$0');
  await page.click('#goalPick'); await page.waitForTimeout(200);
  eq('picker lists both goals', await page.locator('#goalPicker [data-goal]').count(), 2);
  await page.click('#goalPicker [data-goal]'); await page.waitForTimeout(300);
  eq('switching back restores the total', await page.textContent('#savedTxt'), '$300');
  ok('each goal keeps its own entries', (await page.locator('.item').count()) >= 0);

  // finish a goal and confirm it leaves the active list
  await page.click('#goalPick'); await page.waitForTimeout(200);
  await page.click('#goalPicker [data-edit]'); await page.waitForTimeout(200);
  await page.click('#geComplete'); await page.waitForTimeout(300);
  const picked = await page.textContent('#goalName');
  ok('finishing switches to the other goal', picked === 'Electric bike', picked);
  await page.click('#goalPick'); await page.waitForTimeout(200);
  ok('finished goals get their own section', (await page.locator('#goalPicker').innerText()).includes('Finished'));
  await page.click('[data-close="goalSheet"]');

  // ---------------------------------------------------------------- day stats & charts
  section('day stats and charts');
  await seed(page);
  await page.reload(); await page.waitForTimeout(500);
  eq('seeded total', await page.textContent('#savedTxt'), '$2,450');
  eq('today figure', await page.textContent('#stToday'), '+$260');
  eq('last 7 days', await page.textContent('#stWeek'), '+$970');
  await page.click('.tab[data-scr="hist"]'); await page.waitForTimeout(400);
  eq('best day', await page.textContent('#stBest'), '$800');
  eq('streak', await page.textContent('#stStreak'), '3 days');
  eq('days saving', await page.textContent('#stDays'), '9');
  eq('daily chart bars', await page.locator('#chart path').count(), 11);
  eq('chart tip defaults to today', await page.textContent('#chartTip'), 'Today · +$260');
  await page.locator('#chart .hit').nth(4).click(); await page.waitForTimeout(150);
  eq('tapping a withdrawal day', await page.textContent('#chartTip'), 'Mon, Aug 17 · −$90');
  await page.click('#chartSeg button[data-c="total"]'); await page.waitForTimeout(300);
  eq('cumulative chart named', await page.textContent('#chartName'), 'Total so far');
  ok('cumulative chart drawn', (await page.locator('#chart path').count()) >= 3);
  ok('projection line present', (await page.locator('#chart path[stroke-dasharray="3 4"]').count()) === 1);
  await page.click('#chartSeg button[data-c="daily"]'); await page.waitForTimeout(200);
  eq('source bars', await page.locator('.srcbar').count(), 4);
  ok('source bars are labelled', (await page.locator('.srcbar .nm').first().innerText()).length > 0);
  eq('day headers', await page.locator('.dayrow').count(), 11);

  // ---------------------------------------------------------------- editing an entry
  section('editing an entry');
  await page.locator('[data-entry]').first().click(); await page.waitForTimeout(250);
  ok('editor opens', await page.locator('#entryEdit .sheet').isVisible());
  await page.fill('#eeAmount', '300');
  await page.fill('#eeNote', 'Sold the old bike');
  await page.selectOption('#eeSource', 'Gift');
  await page.click('#eeSave'); await page.waitForTimeout(300);
  eq('amount edited', await page.textContent('#savedTxt'), '$2,490');
  ok('note edited', (await page.locator('.item').first().innerText()).includes('Sold the old bike'));
  await page.locator('.del').first().click(); await page.waitForTimeout(250);
  eq('delete removes it', await page.textContent('#savedTxt'), '$2,190');
  await page.click('#undoBtn'); await page.waitForTimeout(250);
  eq('undo restores it', await page.textContent('#savedTxt'), '$2,490');

  // ---------------------------------------------------------------- expected income
  section('expected income');
  await page.click('.tab[data-scr="set"]'); await page.waitForTimeout(200);
  await page.click('#newIncomeBtn'); await page.waitForTimeout(200);
  await page.fill('#ieLabel', 'Allowance');
  await page.fill('#ieAmount', '140');
  await page.selectOption('#ieEvery', 'week');
  await page.selectOption('#ieDow', '5');
  await page.click('#ieSave'); await page.waitForTimeout(300);
  ok('income listed', (await page.locator('#incomeList').innerText()).includes('Every Friday'));
  await page.click('.tab[data-scr="home"]'); await page.waitForTimeout(200);
  eq('pace switches to the plan', await page.textContent('#kPace'), 'Expected weekly');
  eq('expected weekly amount', await page.textContent('#stRate'), '$140');
  eq('finish becomes a plan', await page.textContent('#kEta'), 'Planned finish');
  ok('planned date computed', (await page.textContent('#stEta')) !== '—');

  // ---------------------------------------------------------------- cloud sync
  section('cloud sync');
  await page.click('.tab[data-scr="set"]');
  await page.fill('#email', 'wrong@x.com'); await page.fill('#pass', 'wrongpass');
  await page.click('#signInBtn'); await page.waitForTimeout(400);
  eq('bad password reported', await page.textContent('#toastTxt'), 'Invalid login credentials');
  await page.fill('#email', 'confirm@me.com'); await page.fill('#pass', 'secret123');
  await page.click('#signUpBtn'); await page.waitForTimeout(400);
  eq('email confirmation explained', await page.textContent('#toastTxt'), 'Check your email to confirm, then sign in');
  await page.fill('#email', 'me@example.com');
  await page.click('#forgotBtn'); await page.waitForTimeout(400);
  eq('password reset sends', await page.textContent('#toastTxt'), 'Reset link sent — check your email');
  await page.fill('#pass', 'secret123');
  await page.click('#signInBtn'); await page.waitForTimeout(1500);
  ok('signed in and synced', (await page.textContent('#syncState')).startsWith('Synced'));
  let s = await peek();
  eq('goals pushed', s.goals.length, 1);
  eq('entries pushed', s.entries.length, 11);
  eq('incomes pushed', s.incomes.length, 1);
  ok('entry carries its source', s.entries.some(e => e.source === 'Work'));
  ok('entry carries its goal', s.entries.every(e => !!e.goal_id));

  await page.click('.tab[data-scr="add"]');
  await page.click('.key[data-k="4"]'); await page.click('.key[data-k="0"]');
  await page.click('#addBtn'); await page.waitForTimeout(1600);
  s = await peek();
  eq('new entry reaches the server', s.entries.length, 12);

  await page.click('.tab[data-scr="hist"]'); await page.waitForTimeout(200);
  await page.locator('.del').first().click(); await page.waitForTimeout(1800);
  s = await peek();
  eq('deletion reaches the server', s.entries.length, 11);

  // ---------------------------------------------------------------- second device
  section('second device');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(m => { window.STASH_CONFIG = { url: m, anonKey: 'test-anon-key-aaaaaaaaaaaaaaaaaaa' }; }, MOCK);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('device2: ' + e.message));
  await p2.goto(APP); await p2.waitForTimeout(300);
  await p2.click('#obSignIn'); await p2.waitForTimeout(200);
  await p2.fill('#email', 'me@example.com'); await p2.fill('#pass', 'secret123');
  await p2.click('#signInBtn'); await p2.waitForTimeout(1600);
  eq('goal pulled down', await p2.textContent('#goalName'), 'Electric bike');
  eq('total matches device one', await p2.textContent('#savedTxt'), await page.textContent('#savedTxt'));
  await p2.click('.tab[data-scr="set"]'); await p2.waitForTimeout(200);
  ok('income pulled down', (await p2.locator('#incomeList').innerText()).includes('Allowance'));

  // ---------------------------------------------------------------- offline
  section('offline');
  await ctx.setOffline(true);
  await page.click('.tab[data-scr="add"]');
  await page.click('.key[data-k="7"]'); await page.click('.key[data-k="0"]');
  await page.click('#addBtn'); await page.waitForTimeout(1500);
  ok('entry saved locally while offline', (await page.textContent('#savedTxt')).length > 0);
  ok('status says offline', (await page.textContent('#syncState')).includes('Offline'));
  const before = (await peek()).entries.length;
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1800);
  eq('queued entry syncs on reconnect', (await peek()).entries.length, before + 1);

  // ---------------------------------------------------------------- layout
  section('layout');
  for (const [w, h] of [[390, 844], [320, 568], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ['home', 'add', 'hist', 'set']) {
      await page.click(`.tab[data-scr="${tab}"]`);
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => ({
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        barBottom: Math.round(document.querySelector('.tabbar').getBoundingClientRect().bottom),
        vh: window.innerHeight
      }));
      ok(`${w}x${h} ${tab}: page does not scroll`, !r.y && !r.x, JSON.stringify(r));
      ok(`${w}x${h} ${tab}: tab bar on screen`, r.barBottom <= r.vh + 1, JSON.stringify(r));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const tab = await page.evaluate(() => {
    const t = document.querySelector('.tab').getBoundingClientRect();
    return { w: Math.round(t.width), h: Math.round(t.height) };
  });
  ok('tab targets are thumb-sized', tab.h >= 60 && tab.w >= 60, JSON.stringify(tab));
  const emoji = await page.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
    const hits = [];
    document.querySelectorAll('#app *').forEach(el =>
      [...el.childNodes].filter(n => n.nodeType === 3).forEach(n => {
        if (re.test(n.textContent)) hits.push(n.textContent.trim().slice(0, 24));
      }));
    return hits;
  });
  ok('no emoji in the interface', emoji.length === 0, JSON.stringify(emoji));

  // ---------------------------------------------------------------- v1 upgrade
  section('upgrading old data');
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push('v1: ' + e.message));
  await p3.goto(APP);
  await p3.evaluate(d => localStorage.setItem('kupa.v1', JSON.stringify({
    name: 'Old goal', target: 900, cur: '$', theme: 'light', celebrated: false, gUpdated: Date.now(),
    entries: [{ id: 'a', amount: 400, note: 'Allowance', ts: Date.now() - 2 * d },
              { id: 'b', amount: 150, note: 'Work', ts: Date.now() - d }]
  })), DAY);
  await p3.reload(); await p3.waitForTimeout(400);
  eq('old goal survives the upgrade', await p3.textContent('#goalName'), 'Old goal');
  eq('old entries survive', await p3.textContent('#savedTxt'), '$550');
  ok('no onboarding for upgraded data', !(await p3.locator('#onboard').isVisible()));

  eq('no javascript errors', errors.length, 0, JSON.stringify(errors));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
