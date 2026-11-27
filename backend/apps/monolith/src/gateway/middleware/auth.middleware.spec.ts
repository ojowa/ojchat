import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthMiddleware, isPublicPath } from './auth.middleware';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const USER_SECRET = 'test-user-secret';
const ADMIN_SECRET = 'test-admin-secret';

const userToken = (sub: string) => jwt.sign({ sub }, USER_SECRET, { expiresIn: '5m' });
const adminToken = () => jwt.sign({ role: 'super_admin' }, ADMIN_SECRET, { expiresIn: '5m' });

interface FakeReq {
  method?: string;
  url: string;
  originalUrl: string;
  headers: Record<string, string | undefined>;
  authorization?: string;
  userId?: string;
  isAdminToken?: boolean;
}

const makeReq = (url: string, headers: FakeReq['headers'] = {}, extra: Partial<FakeReq> = {}): FakeReq => ({
  method: 'GET',
  url,
  originalUrl: url,
  headers,
  ...extra,
});

const run = (req: FakeReq) => {
  let error: unknown = null;
  let nextCalled = false;
  new AuthMiddleware().use(req as any, {} as any, (err?: unknown) => {
    nextCalled = true;
    error = err ?? null;
  });
  return { nextCalled, error };
};

describe('AuthMiddleware (x-user-id spoofing fix)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = USER_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });

  it('strips a client-supplied x-user-id header on every request', () => {
    const req = makeReq('/v1/users/me', { 'x-user-id': 'victim-id' });
    run(req);
    expect(req.headers['x-user-id']).toBeUndefined();
  });

  it('rejects requests without a token on protected paths', () => {
    const { error } = run(makeReq('/v1/users/me'));
    expect(error).toBeInstanceOf(UnauthorizedException);
  });

  it('rejects garbage tokens on protected paths', () => {
    const req = makeReq('/v1/matching/feed', { authorization: 'Bearer not-a-jwt' });
    const { error } = run(req);
    expect(error).toBeInstanceOf(UnauthorizedException);
  });

  it('allows anonymous access to public paths', () => {
    for (const path of ['/v1/auth/login', '/v1/health', '/v1/admin/login', '/v1/content/x']) {
      const { error } = run(makeReq(path));
      expect(error).toBeNull();
    }
  });

  it('attaches req.userId from a valid user token and does not restore the header', () => {
    const sub = '11111111-1111-1111-1111-111111111111';
    const req = makeReq('/v1/users/me', {
      authorization: `Bearer ${userToken(sub)}`,
      'x-user-id': 'spoofed',
    });
    const { error } = run(req);
    expect(error).toBeNull();
    expect(req.userId).toBe(sub);
    // main.ts bridge is what re-exposes the header, only from req.userId
    expect(req.headers['x-user-id']).toBeUndefined();
  });

  it('passes valid admin tokens through with isAdminToken set (admin API self-authenticates)', () => {
    const req = makeReq('/v1/admin/dashboard', { authorization: `Bearer ${adminToken()}` });
    const { error } = run(req);
    expect(error).toBeNull();
    expect(req.isAdminToken).toBe(true);
    expect(req.userId).toBeUndefined();
  });

  it('isPublicPath uses path boundaries (siblings are not public)', () => {
    expect(isPublicPath('/v1/auth/login')).toBe(true);
    expect(isPublicPath('/v1/auth/login?next=1')).toBe(true);
    expect(isPublicPath('/v1/auth/login/evil')).toBe(true);
    // sibling routes sharing a prefix must stay protected
    expect(isPublicPath('/v1/auth/password/change')).toBe(false);
    expect(isPublicPath('/v1/auth/logout')).toBe(false);
    expect(isPublicPath('/v1/admin/users')).toBe(false);
  });

  it('never rejects a CORS preflight request on a protected path', () => {
    // Browsers send the OPTIONS preflight WITHOUT the Authorization header.
    // Rejecting it would make the browser block the real (authenticated)
    // request, which is what broke the admin-web user list.
    const { nextCalled, error } = run(makeReq('/v1/admin/users', {}, { method: 'OPTIONS' }));
    expect(nextCalled).toBe(true);
    expect(error).toBeNull();
  });

  it('never rejects a CORS preflight request that carries a bogus token', () => {
    const { error } = run(
      makeReq('/v1/matching/feed', { authorization: 'Bearer not-a-jwt' }, { method: 'OPTIONS' }),
    );
    expect(error).toBeNull();
  });
});

describe('JwtAuthGuard (defense in depth)', () => {
  const guard = new JwtAuthGuard();
  const activate = (req: FakeReq) => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
    return guard.canActivate(ctx);
  };

  it('allows verified user identity', () => {
    expect(activate(makeReq('/v1/users/me', {}, { userId: 'u1' }))).toBe(true);
  });

  it('allows public paths without identity', () => {
    expect(activate(makeReq('/v1/auth/login'))).toBe(true);
  });

  it('allows non-/v1 paths (Swagger UI)', () => {
    expect(activate(makeReq('/docs'))).toBe(true);
  });

  it('allows CORS preflight requests through', () => {
    expect(activate(makeReq('/v1/admin/users', {}, { method: 'OPTIONS' }))).toBe(true);
    expect(activate(makeReq('/v1/matching/feed', {}, { method: 'OPTIONS' }))).toBe(true);
  });

  it('allows admin routes only with a middleware-verified admin token', () => {
    expect(
      activate(makeReq('/v1/admin/dashboard', {}, { isAdminToken: true })),
    ).toBe(true);
    expect(() => activate(makeReq('/v1/admin/dashboard'))).toThrow(UnauthorizedException);
  });

  it('throws for protected /v1 routes without identity', () => {
    expect(() => activate(makeReq('/v1/matching/feed'))).toThrow(UnauthorizedException);
    // a spoofed identity header alone must never satisfy the guard
    expect(() => activate(makeReq('/v1/matching/feed', { 'x-user-id': 'victim' }))).toThrow(
      UnauthorizedException,
    );
  });
});
