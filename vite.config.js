import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';

function loadServiceRoleKey(mode) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const env = loadEnv(mode || 'development', process.cwd(), '');
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (env.SUPABASE_URL) process.env.SUPABASE_URL = env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', 'zhquyedaxszsnswaimza', '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.keys || parsed.api_keys || []);
    const row = list.find((k) => String(k.name || k.id || k.role || '').toLowerCase().includes('service'));
    const key = row?.api_key || row?.key || row?.secret || '';
    if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  } catch (e) {
    console.warn('[vite] Could not load SUPABASE_SERVICE_ROLE_KEY for /api/users');
  }
}

function usersApiPlugin(mode) {
  return {
    name: 'portal-users-api',
    configureServer(server) {
      loadServiceRoleKey(mode);
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/api/users') return next();
        const { default: handler } = await import('./api/users.js');
        return handler(req, res);
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [usersApiPlugin(mode)]
}));
