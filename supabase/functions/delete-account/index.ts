// Deletes the calling user's own account, and with it (via ON DELETE CASCADE
// on every stash_* table) every goal, entry and income they own.
//
// verify_jwt is on for this function, so the platform has already rejected
// any request without a valid session JWT before this code runs. The extra
// admin.auth.getUser(token) call below is a second, explicit check: it is
// what actually resolves *which* user is calling, and it costs nothing to
// double-check on an operation this irreversible.
//
// The service/secret key this needs must never reach the browser. It is
// only available here as an Edge Function default secret.
//
// Deploy with:
//   supabase functions deploy delete-account --project-ref <ref>
import { createClient } from 'npm:@supabase/supabase-js@2';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'missing authorization' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const serviceKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey);

  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) return json({ error: 'invalid session' }, 401);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true }, 200);
});
