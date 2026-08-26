// A stand-in for the Supabase endpoints the app talks to, so the sync layer can be
// tested without touching a real project. Data lives in memory for one test run.
//
//   node tests/mock-supabase.js          # api on :8787, peek/reset on :8788
const http = require('http');
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch { /* realtime checks are skipped without ws */ }

const store = { goals: new Map(), entries: new Map(), incomes: new Map() };
const TABLES = { stash_goals: 'goals', stash_entries: 'entries', stash_incomes: 'incomes' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
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
    if (u.pathname === '/auth/v1/user' && req.method === 'PUT') {
      if (req.headers.authorization !== 'Bearer tok' && req.headers.authorization !== 'Bearer recovery-tok') {
        return send(res, 401, { message: 'bad jwt' });
      }
      return send(res, 200, { id: 'u1', email: 'me@example.com' });
    }
    if (u.pathname === '/functions/v1/delete-account' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer tok') return send(res, 401, { error: 'invalid session' });
      // stands in for the real ON DELETE CASCADE: the account is gone, so is everything in it
      store.goals.clear(); store.entries.clear(); store.incomes.clear();
      return send(res, 200, { ok: true });
    }

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
  if (req.url === '/notify') return send(res, 200, { sent: broadcast(), realtime: !!WebSocketServer });
  if (req.url === '/sockets') return send(res, 200, { open: sockets.size, realtime: !!WebSocketServer });
  send(res, 200, {
    goals: [...store.goals.values()],
    entries: [...store.entries.values()],
    incomes: [...store.incomes.values()]
  });
});

// ---- realtime: just enough of the phoenix protocol for the app's client ----
// join -> phx_reply ok; /notify on the peek port fans a postgres_changes out.
const sockets = new Set();
if (WebSocketServer) {
  const wss = new WebSocketServer({ server: api, path: '/realtime/v1/websocket' });
  wss.on('connection', sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('message', raw => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event === 'phx_join') {
        sock.send(JSON.stringify({
          topic: msg.topic, event: 'phx_reply', ref: msg.ref,
          payload: { status: 'ok', response: {} }
        }));
      }
      if (msg.event === 'heartbeat') {
        sock.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', ref: msg.ref, payload: { status: 'ok' } }));
      }
    });
  });
}
const broadcast = () => {
  const msg = JSON.stringify({
    topic: 'realtime:stash', event: 'postgres_changes',
    payload: { data: { table: 'stash_entries', type: 'INSERT' } }, ref: null
  });
  sockets.forEach(s => { try { s.send(msg); } catch {} });
  return sockets.size;
};

api.listen(8787, () => console.log('mock supabase api on :8787'));
peek.listen(8788, () => console.log('mock supabase peek on :8788'));
