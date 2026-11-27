/**
 * Admin-web connectivity check.
 *
 * Verifies the exact browser sequence the admin panel performs:
 *   1. an OPTIONS preflight for an authenticated GET (no Authorization header),
 *   2. an anonymous request to a protected route (must be rejected),
 *   3. an anonymous request to a public route (must be allowed),
 *   4. optionally, the full admin login -> GET /admin/users flow.
 *
 * The preflight check exists because of a production incident: the auth
 * middleware was registered before the CORS middleware, so it rejected the
 * credential-less preflight with 401 and the browser blocked every
 * authenticated admin-web request — the panel logged in but never loaded data.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/verify-admin-web.ts
 *
 * Environment:
 *   API_BASE         default https://ojchat-backend.vercel.app/v1
 *   ADMIN_WEB_ORIGIN default https://ojchat.vercel.app
 *   ADMIN_EMAIL      optional — enables the authenticated checks
 *   ADMIN_PASSWORD   optional — enables the authenticated checks
 */
const API_BASE = process.env.API_BASE || 'https://ojchat-backend.vercel.app/v1';
const ORIGIN = process.env.ADMIN_WEB_ORIGIN || 'https://ojchat.vercel.app';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log(`API_BASE         = ${API_BASE}`);
  console.log(`ADMIN_WEB_ORIGIN = ${ORIGIN}\n`);

  // 1. CORS preflight for the authenticated admin users request.
  const pre = await fetch(`${API_BASE}/admin/users?page=1&limit=20`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  const acao = pre.headers.get('access-control-allow-origin');
  check('preflight succeeds', pre.status >= 200 && pre.status < 300, String(pre.status));
  check('preflight allows the admin-web origin', acao === ORIGIN, String(acao));
  check(
    'preflight allows the Authorization header',
    (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase().includes('authorization'),
    pre.headers.get('access-control-allow-headers') ?? '(none)',
  );

  // 2. A disallowed origin must not be granted access.
  const preBad = await fetch(`${API_BASE}/admin/users`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  check(
    'preflight from a disallowed origin gets no ACAO header',
    preBad.headers.get('access-control-allow-origin') === null,
    preBad.headers.get('access-control-allow-origin') ?? '(none)',
  );
  check('preflight from a disallowed origin is not a 500', preBad.status !== 500, String(preBad.status));

  // 3. Public route stays reachable anonymously.
  const health = await fetch(`${API_BASE}/health`);
  check(
    'public route is reachable without a token',
    health.status !== 401 && health.status !== 404,
    String(health.status),
  );

  // 4. Protected route stays closed to anonymous callers.
  const anon = await fetch(`${API_BASE}/admin/users`);
  check('protected admin route rejects anonymous callers', anon.status === 401, String(anon.status));

  // 5. Full admin flow (only when credentials are supplied).
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const login = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const loginBody: any = await login.json();
    const token = loginBody?.data?.tokens?.accessToken;
    check('admin login succeeds', login.status === 201 && !!token, String(login.status));

    if (token) {
      const users = await fetch(`${API_BASE}/admin/users?page=1&limit=20`, {
        headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN },
      });
      const body: any = await users.json();
      const data = body?.data ?? body;
      check('GET /admin/users succeeds with the admin token', users.status === 200, String(users.status));
      check('GET /admin/users returns the user list', Array.isArray(data?.users), JSON.stringify(data?.meta));
      check(
        'GET /admin/users response carries CORS headers for the admin-web origin',
        users.headers.get('access-control-allow-origin') === ORIGIN,
        users.headers.get('access-control-allow-origin') ?? '(none)',
      );
    }
  } else {
    console.log('SKIP  admin login checks (set ADMIN_EMAIL and ADMIN_PASSWORD to enable)');
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
