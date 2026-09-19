function supabaseUrl() {
  return process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://zhquyedaxszsnswaimza.supabase.co';
}
function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
function anonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    serviceKey();
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body || '{}')); } catch (e) { return reject(e); }
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function sbFetch(path, { method = 'GET', token, body, prefer } = {}) {
  const key = serviceKey();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${supabaseUrl()}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

async function requireAdmin(req) {
  if (!serviceKey()) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server', status: 500 };
  const hdr = req.headers.authorization || req.headers.Authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!token) return { error: 'Missing login token', status: 401 };

  const userRes = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${token}` }
  });
  const user = await userRes.json().catch(() => null);
  if (!userRes.ok || !user?.id) return { error: 'Not signed in', status: 401 };

  const profRes = await sbFetch(
    `/rest/v1/profiles?user_id=eq.${user.id}&select=user_id,email,role`
  );
  const profile = Array.isArray(profRes.data) ? profRes.data[0] : null;
  if (!profile || profile.role !== 'admin') return { error: 'Admin only', status: 403 };
  return { user, profile };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = await requireAdmin(req);
  if (gate.error) return json(res, gate.status, { error: gate.error });

  try {
    if (req.method === 'GET') {
      const usersRes = await sbFetch('/auth/v1/admin/users?per_page=200');
      if (!usersRes.ok) return json(res, usersRes.status, { error: usersRes.data?.msg || usersRes.data?.error || 'Could not list users' });
      const authUsers = usersRes.data?.users || [];
      const profRes = await sbFetch('/rest/v1/profiles?select=user_id,email,role,created_at');
      const profiles = Array.isArray(profRes.data) ? profRes.data : [];
      const byId = new Map(profiles.map((p) => [p.user_id, p]));
      const users = authUsers.map((u) => {
        const p = byId.get(u.id);
        return {
          id: u.id,
          email: u.email,
          role: p?.role || 'user',
          created_at: u.created_at,
          banned: !!(u.banned_until && new Date(u.banned_until) > new Date())
        };
      });
      return json(res, 200, { users });
    }

    const body = await readBody(req);

    if (req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!email || !password || password.length < 8) {
        return json(res, 400, { error: 'Email and a password of at least 8 characters are required' });
      }
      const created = await sbFetch('/auth/v1/admin/users', {
        method: 'POST',
        body: { email, password, email_confirm: true }
      });
      if (!created.ok) {
        return json(res, created.status, { error: created.data?.msg || created.data?.error_description || created.data?.error || 'Could not create user' });
      }
      const id = created.data?.id;
      if (id) {
        await sbFetch('/rest/v1/profiles?user_id=eq.' + id, {
          method: 'PATCH',
          body: { email, role },
          prefer: 'return=minimal'
        });
      }
      return json(res, 200, { ok: true, id, email, role });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '').trim();
      if (!id) return json(res, 400, { error: 'User id is required' });

      if (body.role === 'admin' || body.role === 'user') {
        await sbFetch('/rest/v1/profiles?user_id=eq.' + id, {
          method: 'PATCH',
          body: { role: body.role },
          prefer: 'return=minimal'
        });
      }
      if (body.banned === true) {
        const banned = await sbFetch('/auth/v1/admin/users/' + id, {
          method: 'PUT',
          body: { ban_duration: '876000h' }
        });
        if (!banned.ok) return json(res, banned.status, { error: banned.data?.msg || 'Could not disable user' });
      }
      if (body.banned === false) {
        const unban = await sbFetch('/auth/v1/admin/users/' + id, {
          method: 'PUT',
          body: { ban_duration: 'none' }
        });
        if (!unban.ok) return json(res, unban.status, { error: unban.data?.msg || 'Could not enable user' });
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' });
  }
}
