import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const portalPages = [
  'index.html',
  'current-month.html',
  'dealer-history.html',
  'dealer-report.html',
  'rep-report.html',
  'state-report.html',
  'indextest.html',
  'test-settings.html'
];

function portalScripts() {
  return {
    name: 'portal-classic-scripts',
    apply: 'build',
    async buildStart() {
      // Keep these scripts at their existing URLs with their shared browser globals.
      for (const fileName of ['src/app.js', 'master-dealers-module.js']) {
        const path = resolve(import.meta.dirname, fileName);
        this.addWatchFile(path);
        this.emitFile({ type: 'asset', fileName, source: await readFile(path) });
      }
    }
  };
}

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
  plugins: [usersApiPlugin(mode), portalScripts()],
  build: {
    rollupOptions: {
      input: portalPages.map((page) => resolve(import.meta.dirname, page))
    }
  }
}));
