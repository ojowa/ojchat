import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isPublicPath } from '../middleware/auth.middleware';

type AuthedRequest = Request & {
  userId?: string;
  isAdminToken?: boolean;
};

/**
 * Defense-in-depth for the express AuthMiddleware.
 *
 * The middleware already enforces auth for every HTTP request before routing;
 * this guard guarantees that no Nest route under /v1 can execute without a
 * verified identity even if the middleware is removed or reordered in the
 * future. It relies only on flags the middleware sets after cryptographic
 * verification — a client-supplied `x-user-id` header is never consulted
 * (the middleware strips it unconditionally).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const url = String(req.originalUrl || req.url || '');

    // CORS preflight: no credentials are attached, so it can never satisfy
    // authentication and must not be rejected.
    if (req.method === 'OPTIONS') return true;

    // Verified user JWT — identity established by the middleware.
    if (req.userId) return true;

    // Non-/v1 paths: Swagger UI, spec, and other express-level assets.
    if (!url.startsWith('/v1')) return true;

    // Explicitly public pre-auth flows, webhooks, health, content.
    if (isPublicPath(url)) return true;

    // Admin API: token verified against ADMIN_JWT_SECRET by the middleware;
    // the admin controller re-validates it per route (verifyAuth/requireRole).
    if (url.startsWith('/v1/admin') && req.isAdminToken) return true;

    throw new UnauthorizedException('Authentication required');
  }
}
