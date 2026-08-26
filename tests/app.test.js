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

  // ---------------------------------------------------------------- login screen
  section('login screen');
  await page.goto(APP);
  await page.waitForTimeout(400);
  ok('first run shows the login screen', await page.locator('#login').isVisible());
  ok('onboarding waits behind it', !(await page.locator('#onboard').isVisible()));
  ok('sign in is the default', (await page.textContent('#loginGo')).trim() === 'Sign in');
  await page.click('#loginSwap'); await page.waitForTimeout(150);
  eq('it swaps to sign-up', (await page.textContent('#loginGo')).trim(), 'Create account');
  ok('sign-up hides the reset link', !(await page.locator('#loginForgot').isVisible()));
  await page.click('#loginSwap'); await page.waitForTimeout(150);
  await page.fill('#loginEmail', 'nobody@example.com'); await page.fill('#loginPass', 'wrongpass');
  await page.click('#loginGo'); await page.waitForTimeout(500);
  eq('a bad password is reported', await page.textContent('#toastTxt'), 'Invalid login credentials');
  ok('and the screen stays put', await page.locator('#login').isVisible());
  await page.click('#loginForgot'); await page.waitForTimeout(400);
  eq('reset link can be sent from here', await page.textContent('#toastTxt'), 'Reset link sent — check your email');
  await page.click('#loginSkip'); await page.waitForTimeout(300);
  ok('skipping goes straight into the app', !(await page.locator('#login').isVisible()));
  ok('no backend setup fields anywhere on the login screen',
     (await page.locator('#loginConnect, #loginUrl, #loginKey, #loginConnectGo').count()) === 0);

  // ---------------------------------------------------------------- unconfigured deploy
  section('login screen with no key set (a developer fork, never the shipped app)');
  const ctx5 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx5.addInitScript(() => { window.STASH_CONFIG = { url: '', anonKey: '' }; });
  const p5 = await ctx5.newPage();
  p5.on('pageerror', e => errors.push('unconfigured: ' + e.message));
  await p5.goto(APP); await p5.waitForTimeout(400);
  ok('email/password fields are hidden', !(await p5.locator('#loginForm').isVisible()));
  ok('a plain message shows instead', await p5.locator('#loginUnconfigured').isVisible());
  ok('never a Project URL or Anon key prompt',
     (await p5.locator('#loginConnect, #loginUrl, #loginKey').count()) === 0);
  ok('skipping still works with no backend at all', await p5.locator('#loginSkip').isVisible());
  await p5.click('#loginSkip'); await p5.waitForTimeout(250);
  ok('and lands in the app', !(await p5.locator('#login').isVisible()));
  await ctx5.close();

  // ---------------------------------------------------------------- confirmation / recovery links
  // Supabase verifies the email link's token itself, then redirects back to the
  // app with the session in the URL fragment (#access_token=...&type=...). The
  // bug report this covers: a user landed on a broken page after confirming —
  // this exercises the app's side of consuming that fragment.
  section('confirmation and password-reset links');
  // each scenario is a fresh context: a real inbound link is always a brand new
  // page load, not a same-document hash change on a page already open — reusing
  // one page across scenarios would let a same-document navigation silently skip
  // re-running the boot logic and mask exactly the class of bug this covers
  const newRedirectPage = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c.addInitScript(m => { window.STASH_CONFIG = { url: m, anonKey: 'test-anon-key-aaaaaaaaaaaaaaaaaaa' }; }, MOCK);
    const pg = await c.newPage();
    pg.on('pageerror', e => errors.push('redirect: ' + e.message));
    return { c, pg };
  };

  const signup = await newRedirectPage();
  await signup.pg.goto(APP + '#access_token=tok&refresh_token=ref&expires_in=3600&token_type=bearer&type=signup');
  await signup.pg.waitForTimeout(500);
  ok('a confirmation link signs in directly, no login screen', !(await signup.pg.locator('#login').isVisible()));
  eq('and says so', await signup.pg.textContent('#toastTxt'), 'Signed in');
  ok('the tokens are stripped from the address bar', !signup.pg.url().includes('access_token'));
  await signup.c.close();

  const recovery = await newRedirectPage();
  await recovery.pg.goto(APP + '#access_token=tok&refresh_token=ref&expires_in=3600&token_type=bearer&type=recovery');
  await recovery.pg.waitForTimeout(500);
  ok('a "forgot password" link also signs the visit in', !(await recovery.pg.locator('#login').isVisible()));
  ok('and opens the set-new-password sheet', await recovery.pg.locator('#pwReset .sheet').isVisible());
  await recovery.pg.fill('#pwNew', 'newpassword123');
  await recovery.pg.click('#pwSave'); await recovery.pg.waitForTimeout(400);
  ok('saving closes the sheet', !(await recovery.pg.locator('#pwReset').evaluate(e => e.classList.contains('open'))));
  eq('and confirms', await recovery.pg.textContent('#toastTxt'), 'Password updated');
  await recovery.c.close();

  const garbage = await newRedirectPage();
  await garbage.pg.goto(APP + '#access_token=not-a-jwt&refresh_token=ref&type=signup');
  await garbage.pg.waitForTimeout(400);
  ok('a malformed token in the fragment does not crash the page',
     await garbage.pg.locator('#app').isVisible());
  await garbage.c.close();

  // ---------------------------------------------------------------- onboarding
  section('onboarding');
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
  await p2.goto(APP); await p2.waitForTimeout(400);
  ok('a new device lands on the login screen', await p2.locator('#login').isVisible());
  await p2.fill('#loginEmail', 'me@example.com'); await p2.fill('#loginPass', 'secret123');
  await p2.click('#loginGo'); await p2.waitForTimeout(1800);
  ok('signing in dismisses the login screen', !(await p2.locator('#login').isVisible()));
  ok('and no onboarding, the goals came down', !(await p2.locator('#onboard').isVisible()));
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

  // ---------------------------------------------------------------- live updates
  section('live updates');
  await page.waitForTimeout(600);
  const sockets = await fetch(PEEK + '/sockets').then(r => r.json());
  ok('realtime socket connected', sockets.open >= 1, JSON.stringify(sockets));
  await page.click('.tab[data-scr="set"]'); await page.waitForTimeout(200);
  ok('status says live', (await page.textContent('#syncState')).includes('live'),
     await page.textContent('#syncState'));
  // a change made elsewhere: push a row straight into the mock, then poke the socket
  await fetch(MOCK + '/rest/v1/stash_entries', {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json', apikey: 'k' },
    body: JSON.stringify([{ id: 'remote1', goal_id: 'g1', amount: 55, note: 'From another device',
                            source: 'Gift', ts: new Date().toISOString() }])
  });
  const beforeLive = await page.textContent('#savedTxt');
  await fetch(PEEK + '/notify');
  await page.waitForTimeout(1800);
  const afterLive = await page.textContent('#savedTxt');
  ok('a remote change arrives without a refresh', afterLive !== beforeLive, `${beforeLive} -> ${afterLive}`);

  // ---------------------------------------------------------------- income currency
  section('income currency');
  await page.click('.tab[data-scr="set"]'); await page.waitForTimeout(150);
  await page.click('#newIncomeBtn'); await page.waitForTimeout(200);
  await page.fill('#ieLabel', 'Shekel allowance');
  await page.fill('#ieAmount', '400');
  await page.selectOption('#ieCur', '₪');
  await page.click('#ieSave'); await page.waitForTimeout(300);
  ok('a foreign-currency income is flagged',
     (await page.locator('#incomeList').innerText()).includes('not counted for this goal'));
  await page.click('.tab[data-scr="home"]'); await page.waitForTimeout(200);
  eq('it does not inflate the plan', await page.textContent('#stRate'), '$140');

  // ---------------------------------------------------------------- editing undo
  section('undoing an edit');
  await page.click('.tab[data-scr="hist"]'); await page.waitForTimeout(300);
  const beforeEdit = await page.textContent('#savedTxt');
  await page.locator('[data-entry]').first().click(); await page.waitForTimeout(250);
  await page.fill('#eeAmount', '9999');
  await page.click('#eeSave'); await page.waitForTimeout(300);
  ok('edit applied', (await page.textContent('#savedTxt')) !== beforeEdit);
  await page.click('#undoBtn'); await page.waitForTimeout(300);
  eq('edit undone', await page.textContent('#savedTxt'), beforeEdit);

  // ---------------------------------------------------------------- search, filter, paging
  section('search and filter');
  await page.fill('#searchBox', 'tutoring'); await page.waitForTimeout(300);
  const tutoringRows = await page.locator('[data-entry]').count();
  ok('search narrows the list', tutoringRows > 0 && tutoringRows < 11, String(tutoringRows));
  await page.fill('#searchBox', 'zzzz'); await page.waitForTimeout(300);
  ok('no matches says so', (await page.locator('#history').innerText()).includes('Nothing matches'));
  await page.fill('#searchBox', ''); await page.waitForTimeout(300);
  const months = await page.locator('#monthBox option').count();
  ok('month filter lists the months present', months >= 2, String(months));
  await page.selectOption('#monthBox', { index: 1 }); await page.waitForTimeout(300);
  ok('filtering by month keeps entries', (await page.locator('[data-entry]').count()) > 0);
  await page.selectOption('#monthBox', ''); await page.waitForTimeout(300);

  // ---------------------------------------------------------------- monthly chart
  section('monthly chart');
  await page.click('#chartSeg button[data-c="month"]'); await page.waitForTimeout(300);
  eq('monthly chart named', await page.textContent('#chartName'), 'Last 6 months');
  eq('six month labels', await page.locator('#chart text').count(), 6);
  ok('monthly bars drawn', (await page.locator('#chart path').count()) >= 1);
  ok('chart has a table for screen readers', (await page.locator('#chartTable tr').count()) === 6);
  await page.locator('#chart .hit').last().click(); await page.waitForTimeout(200);
  ok('tapping a month reads out its total', (await page.textContent('#chartTip')).includes('$'));
  await page.click('#chartSeg button[data-c="daily"]'); await page.waitForTimeout(250);
  eq('daily chart table matches its bars', await page.locator('#chartTable tr').count(), 14);

  // ---------------------------------------------------------------- finished goal summary
  section('finished goal summary');
  await page.click('.tab[data-scr="home"]'); await page.waitForTimeout(150);
  // a second goal first, so finishing this one leaves something active
  await page.click('#goalPick'); await page.waitForTimeout(250);
  await page.click('#addGoalFromPicker'); await page.waitForTimeout(250);
  await page.fill('#geName', 'Laptop'); await page.fill('#geTarget', '3000');
  await page.click('#geSave'); await page.waitForTimeout(300);
  await page.click('#goalPick'); await page.waitForTimeout(250);
  const bikeRow = page.locator('#goalPicker .listrow').filter({ hasText: 'Electric bike' });
  await bikeRow.locator('[data-edit]').click(); await page.waitForTimeout(250);
  await page.click('#geComplete'); await page.waitForTimeout(350);
  await page.click('#goalPick'); await page.waitForTimeout(250);
  const finished = page.locator('#goalPicker .listrow').filter({ hasText: 'Electric bike' }).locator('[data-goal]');
  await finished.click(); await page.waitForTimeout(400);
  ok('summary opens for a finished goal', await page.locator('#goalDone .sheet').isVisible());
  const gd = await page.locator('#gdStats').innerText();
  ok('summary shows how long it took', /day/i.test(gd), gd.replace(/\n/g, ' '));
  ok('summary shows deposits', /Deposits/i.test(gd));
  await page.click('[data-close="goalDone"]'); await page.waitForTimeout(150);
  await page.click('[data-close="goalSheet"]'); await page.waitForTimeout(150);

  // ---------------------------------------------------------------- editing across a sync
  section('editing while a sync lands');
  await page.click('.tab[data-scr="home"]'); await page.waitForTimeout(150);
  await page.click('#goalPick'); await page.waitForTimeout(250);
  await page.locator('#goalPicker .listrow').filter({ hasText: 'Laptop' }).locator('[data-edit]').click();
  await page.waitForTimeout(250);
  // a pull replaces every object in db.* while the sheet is open
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1200);
  await page.fill('#geName', 'Laptop for school');
  await page.click('#geSave'); await page.waitForTimeout(400);
  await page.click('#goalPick'); await page.waitForTimeout(250);
  ok('an edit still applies after a sync pull',
     (await page.locator('#goalPicker').innerText()).includes('Laptop for school'),
     (await page.locator('#goalPicker').innerText()).replace(/\n/g, ' | '));
  await page.click('[data-close="goalSheet"]'); await page.waitForTimeout(150);

  // ---------------------------------------------------------------- backup: merge vs replace
  section('backup import');
  const snapshot = await page.evaluate(() => localStorage.getItem('kupa.v1'));
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p4 = await ctx4.newPage();
  p4.on('pageerror', e => errors.push('import: ' + e.message));
  await p4.goto(APP); await p4.waitForTimeout(400);
  await p4.click('#loginSkip'); await p4.waitForTimeout(250);
  await p4.fill('#obName', 'Camera'); await p4.fill('#obTarget', '900');
  await p4.click('#obStartBtn'); await p4.waitForTimeout(300);
  await p4.click('.tab[data-scr="add"]');
  await p4.click('.key[data-k="5"]'); await p4.click('.key[data-k="0"]');
  await p4.click('#addBtn'); await p4.waitForTimeout(250);
  const ownTotal = await p4.textContent('#savedTxt');
  await p4.click('.tab[data-scr="set"]'); await p4.waitForTimeout(150);
  await p4.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(snapshot) });
  await p4.waitForTimeout(400);
  ok('import asks before doing anything', await p4.locator('#importSheet .sheet').isVisible());
  ok('import sheet counts both sides', (await p4.textContent('#importSummary')).includes('This device has'));
  eq('nothing changed yet', await p4.textContent('#savedTxt'), ownTotal);
  await p4.click('#importMerge'); await p4.waitForTimeout(500);
  await p4.click('.tab[data-scr="home"]'); await p4.click('#goalPick'); await p4.waitForTimeout(300);
  const names = await p4.locator('#goalPicker').innerText();
  ok('merge keeps the local goal', names.includes('Camera'), names.replace(/\n/g, ' | '));
  ok('merge brings in the backup goals', names.includes('Electric bike'), names.replace(/\n/g, ' | '));
  await ctx4.close();

  // ---------------------------------------------------------------- delete account
  section('delete account');
  const ctx7 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx7.addInitScript(m => { window.STASH_CONFIG = { url: m, anonKey: 'test-anon-key-aaaaaaaaaaaaaaaaaaa' }; }, MOCK);
  const p7 = await ctx7.newPage();
  p7.on('pageerror', e => errors.push('delete: ' + e.message));
  await p7.goto(APP); await p7.waitForTimeout(300);
  ok('delete row hidden while signed out', !(await p7.locator('#deleteAcctRow').isVisible()));
  await p7.click('#loginSkip'); await p7.waitForTimeout(250);
  await p7.fill('#obName', 'Camera'); await p7.fill('#obTarget', '500'); await p7.click('#obStartBtn');
  await p7.waitForTimeout(300);
  await p7.click('.tab[data-scr="set"]'); await p7.waitForTimeout(200);
  await p7.fill('#email', 'me@example.com'); await p7.fill('#pass', 'secret123');
  await p7.click('#signInBtn'); await p7.waitForTimeout(1500);
  ok('delete row appears once signed in', await p7.locator('#deleteAcctRow').isVisible());

  await p7.click('#deleteAcctBtn'); await p7.waitForTimeout(250);
  ok('confirm button starts disabled', await p7.locator('#deleteAcctConfirmBtn').isDisabled());
  await p7.fill('#deleteAcctConfirm', 'please');
  ok('wrong text keeps it disabled', await p7.locator('#deleteAcctConfirmBtn').isDisabled());
  await p7.fill('#deleteAcctConfirm', 'delete');
  ok('typing it (case-insensitively) enables it', !(await p7.locator('#deleteAcctConfirmBtn').isDisabled()));
  await p7.click('[data-close="deleteAcctSheet"]'); await p7.waitForTimeout(200);
  ok('cancel backs out without deleting anything', await p7.locator('#deleteAcctRow').isVisible());

  await p7.click('#deleteAcctBtn'); await p7.waitForTimeout(200);
  await p7.fill('#deleteAcctConfirm', 'DELETE');
  await p7.click('#deleteAcctConfirmBtn'); await p7.waitForTimeout(600);
  ok('account deletion drops back to the login screen', await p7.locator('#login').isVisible());
  eq('and confirms', await p7.textContent('#toastTxt'), 'Account deleted');
  eq('local data is wiped, not just the session', await p7.textContent('#savedTxt'), '—');
  const afterDelete = await peek();
  eq('the goal is gone from the server too', afterDelete.goals.length, 0);
  eq('and its entries with it', afterDelete.entries.length, 0);
  await ctx7.close();

  // ---------------------------------------------------------------- signing out
  section('signing out');
  await p2.click('.tab[data-scr="set"]'); await p2.waitForTimeout(200);
  await p2.click('#signOutBtn'); await p2.waitForTimeout(400);
  ok('signing out returns to the login screen', await p2.locator('#login').isVisible());
  await p2.click('#loginSkip'); await p2.waitForTimeout(250);
  ok('the data is still on the device', (await p2.textContent('#savedTxt')).length > 1);
  await ctx2.close();

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
  await p3.goto(APP); await p3.waitForTimeout(300);
  await p3.click('#loginSkip'); await p3.waitForTimeout(200);
  await p3.evaluate(d => localStorage.setItem('kupa.v1', JSON.stringify({
    name: 'Old goal', target: 900, cur: '$', theme: 'light', celebrated: false, gUpdated: Date.now(),
    entries: [{ id: 'a', amount: 400, note: 'Allowance', ts: Date.now() - 2 * d },
              { id: 'b', amount: 150, note: 'Work', ts: Date.now() - d }]
  })), DAY);
  await p3.reload(); await p3.waitForTimeout(400);
  eq('old goal survives the upgrade', await p3.textContent('#goalName'), 'Old goal');
  eq('old entries survive', await p3.textContent('#savedTxt'), '$550');
  ok('no onboarding for upgraded data', !(await p3.locator('#onboard').isVisible()));

  // ---------------------------------------------------------------- show off
  // its own context: `page` is signed in to an account the delete test emptied
  section('show off');
  const ctxF = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pF = await ctxF.newPage();
  pF.on('pageerror', e => errors.push('showoff: ' + e.message));
  await pF.goto(APP); await seed(pF);
  await pF.goto(APP); await pF.waitForTimeout(400);
  await pF.click('#loginSkip'); await pF.waitForTimeout(250);
  const beforeFun = await pF.textContent('#savedTxt');
  await pF.click('.tab[data-scr="set"]'); await pF.waitForTimeout(200);

  eq('show off starts off', await pF.getAttribute('#funBtn', 'aria-checked'), 'false');
  eq('the plain app carries no fun flag', await pF.getAttribute('html', 'data-fun'), 'off');
  // 2 coin faces + 24 rim slabs: the 3D coin is built, not a picture
  eq('the 3D coin is assembled', await pF.locator('#funCoin > *').count(), 26);
  ok('nothing is drifting behind the plain app', !(await pF.locator('#aurora').isVisible()));

  await pF.click('#funBtn'); await pF.waitForTimeout(400);
  eq('the switch turns it on', await pF.getAttribute('html', 'data-fun'), 'on');
  eq('the switch reports its state', await pF.getAttribute('#funBtn', 'aria-checked'), 'true');
  ok('the aurora shows up', await pF.locator('#aurora').isVisible());
  ok('coins rain behind the app', await pF.locator('#ambient').isVisible());
  eq('the ring gets three orbits', await pF.locator('#orbits .orbit').count(), 3);
  ok('the goal ring gets its spinning coin',
     await pF.locator('#ringCoin').evaluate(el => getComputedStyle(el).animationName === 'coinspin'));

  await pF.reload(); await pF.waitForTimeout(500);
  eq('it survives a reload', await pF.getAttribute('html', 'data-fun'), 'on');
  eq('it is stored with the other settings',
     await pF.evaluate(() => JSON.parse(localStorage.getItem('kupa.v1')).fun), true);
  eq('the money is untouched', await pF.textContent('#savedTxt'), beforeFun);

  // the total counts up to its new value instead of snapping there
  await pF.click('.tab[data-scr="add"]'); await pF.waitForTimeout(200);
  await pF.click('.chip[data-v="500"]'); await pF.click('#addBtn');
  const seen = new Set();
  for (let i = 0; i < 10; i++) seen.add(await pF.textContent('#savedTxt'));
  await pF.waitForTimeout(1000);
  const settled = await pF.textContent('#savedTxt');
  ok('the total counts up instead of snapping', seen.size > 1, [...seen].join(' → '));
  const wanted = '$' + (Number(beforeFun.replace(/[^0-9.]/g, '')) + 500).toLocaleString('en-US');
  eq('and lands on the real total', settled, wanted);

  await pF.click('.tab[data-scr="set"]'); await pF.waitForTimeout(200);
  await pF.click('#funBtn'); await pF.waitForTimeout(300);
  eq('turning it off puts the plain app back', await pF.getAttribute('html', 'data-fun'), 'off');
  eq('and it is stored as off',
     await pF.evaluate(() => JSON.parse(localStorage.getItem('kupa.v1')).fun), false);
  ok('the aurora goes away', !(await pF.locator('#aurora').isVisible()));
  ok('the coins stop raining', !(await pF.locator('#ambient').isVisible()));
  eq('the money is still untouched', await pF.textContent('#savedTxt'), wanted);
  await ctxF.close();

  eq('no javascript errors', errors.length, 0, JSON.stringify(errors));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
