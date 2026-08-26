// A stand-in for the Supabase endpoints the app talks to, so the sync layer can be
// tested without touching a real project. Data lives in memory for one test run.
//
//   node tests/mock-supabase.js          # api on :8787, peek/reset on :8788
const http = require('http');

const store = { goals: new Map(), entries: new Map(), incomes: new Map() };
const TABLES = { stash_goals: 'goals', stash_entries: 'entries', stash_incomes: 'incomes' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
};
const send = (res, code, body) => {
  res.writeHead(code, { ...cors, 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const stamp = row => ({
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...row
});

const api = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { return send(res, 400, { message: 'bad json' }); }

    // ---- auth ----
    if (u.pathname === '/auth/v1/token' || u.pathname === '/auth/v1/signup') {
      if (body && body.password === 'wrongpass') return send(res, 400, { error_description: 'Invalid login credentials' });
      if (body && body.email === 'confirm@me.com') return send(res, 200, { id: 'u1', email: body.email });
      return send(res, 200, {
        access_token: 'tok', refresh_token: 'ref', expires_in: 3600,
        user: { email: (body && body.email) || '' }
      });
    }
    if (u.pathname === '/auth/v1/recover') return send(res, 200, {});

    // ---- rest ----
    if (req.headers.authorization !== 'Bearer tok') return send(res, 401, { message: 'bad jwt' });
    const table = TABLES[u.pathname.replace('/rest/v1/', '')];
    if (!table) return send(res, 404, { message: 'no route ' + req.method + ' ' + u.pathname });
    const rows = store[table];

    if (req.method === 'GET') return send(res, 200, [...rows.values()]);
    if (req.method === 'POST') {
      (Array.isArray(body) ? body : [body]).forEach(r => {
        const prev = rows.get(r.id);
        rows.set(r.id, { ...stamp(prev || {}), ...r, updated_at: new Date().toISOString() });
      });
      return send(res, 201);
    }
    if (req.method === 'DELETE') {
      const id = decodeURIComponent((u.searchParams.get('id') || '').replace('eq.', ''));
      rows.delete(id);
      return send(res, 204);
    }
    send(res, 405, { message: 'method not allowed' });
  });
});

// second port: let the test read and reset what the "server" holds
const peek = http.createServer((req, res) => {
  if (req.url === '/reset') {
    Object.values(store).forEach(m => m.clear());
    return send(res, 200, { reset: true });
  }
  send(res, 200, {
    goals: [...store.goals.values()],
    entries: [...store.entries.values()],
    incomes: [...store.incomes.values()]
  });
});

api.listen(8787, () => console.log('mock supabase api on :8787'));
peek.listen(8788, () => console.log('mock supabase peek on :8788'));
