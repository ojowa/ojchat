import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for the "admin panel logs in but no data loads" bug.
 *
 * Browsers send an OPTIONS preflight WITHOUT the Authorization header and
 * only send the real credentialed request once the preflight succeeds. If the
 * auth middleware is registered before the CORS middleware, the preflight is
 * rejected with 401 and no CORS headers, so the browser blocks the real
 * request outright. The admin-web therefore authenticated successfully and
 * then silently failed to load any data.
 *
 * The ordering lives in main.ts and cannot be exercised without booting the
 * full app (which needs a live database), so it is asserted statically here.
 */
describe('main.ts middleware ordering', () => {
  const source = readFileSync(join(__dirname, 'main.ts'), 'utf8');

  it('registers CORS before the auth middleware', () => {
    const corsIndex = source.indexOf('app.enableCors(');
    const authIndex = source.indexOf('new AuthMiddleware()');

    expect(corsIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(-1);
    expect(corsIndex).toBeLessThan(authIndex);
  });

  it('registers CORS exactly once', () => {
    expect(source.match(/app\.enableCors\(/g) ?? []).toHaveLength(1);
  });

  it('allows the admin-web origin', () => {
    expect(source).toContain("'https://ojchat.vercel.app'");
  });
});
