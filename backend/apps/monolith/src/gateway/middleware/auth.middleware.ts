import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Routes reachable WITHOUT a verified identity token. Keep this list minimal —
 * every other /v1 path requires a valid Bearer token (user JWT or admin JWT).
 *
 * Matching is boundary-aware: an entry matches the path itself or anything
 * below it (`/v1/auth/login/extra`), but NOT sibling routes that merely share
 * the prefix (e.g. `/v1/auth/password/change` is NOT covered by
 * `/v1/auth/password/reset`).
 */
export const PUBLIC_PATHS: string[] = [
  // Pre-authentication flows
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/otp/send',
  '/v1/auth/otp/verify',
  '/v1/auth/refresh',
  '/v1/auth/biometric/login',
  '/v1/auth/password/forgot',
  '/v1/auth/password/reset',
  '/v1/auth/2fa/verify', // login 2FA — identity is proven by tempToken in the body
  // Anonymous integrations / probes
  '/v1/health',
  '/v1/admin/login',
  '/v1/payments/webhook/paystack',
  '/v1/content',
  '/v1/support',
  '/docs', // Swagger UI + spec (served outside the /v1 prefix)
];

/** True when the request URL (query string ignored) is on the public list. */
export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Zero-trust auth middleware.
 *
 * Previously this middleware never rejected anything, and main.ts only
 * overwrote `x-user-id` when a token was verified — so an anonymous caller
 * could supply their own `x-user-id` header and impersonate any user on
 * every endpoint (controllers read @Headers('x-user-id')).
 *
 * Now:
 *  1. The client-supplied `x-user-id` header is ALWAYS stripped.
 *  2. Requests without a token are rejected unless the path is public.
 *  3. Tokens are verified against JWT_SECRET; a valid identity is attached
 *     as req.userId and only then re-exposed as `x-user-id` (in main.ts).
 *  4. Admin tokens (signed with ADMIN_JWT_SECRET) pass through so the admin
 *     controller can authenticate per-route with verifyAuth()/requireRole().
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // Never trust a client-supplied identity header.
    delete req.headers['x-user-id'];

    const url = (req as any).originalUrl || req.url;
    const isPublic = isPublicPath(url);

    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
      return isPublic ? next() : next(new UnauthorizedException('Authentication required'));
    }

    const userSecret = process.env.JWT_SECRET;
    if (!userSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    try {
      const payload: any = jwt.verify(token, userSecret);
      if (payload && payload.sub) {
        (req as any).userId = payload.sub;
      }
      return next();
    } catch {
      // Not a user token — the admin API uses a separate secret and does its
      // own per-route verification, so a valid admin token may pass through.
      if (this.isVerifiedAdminToken(token)) {
        (req as any).isAdminToken = true;
        return next();
      }
      return isPublic
        ? next()
        : next(new UnauthorizedException('Invalid or expired token'));
    }
  }

  private isVerifiedAdminToken(token: string): boolean {
    const adminSecret = process.env.ADMIN_JWT_SECRET;
    if (!adminSecret) return false;
    try {
      return !!jwt.verify(token, adminSecret);
    } catch {
      return false;
    }
  }
}
