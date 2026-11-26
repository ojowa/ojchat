export interface AuthTokenPair {
  accessToken: string;
  refreshToken?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseAuthTokenResponse(response: unknown): AuthTokenPair | null {
  const body = asRecord(response);
  const payload = asRecord(body?.data) ?? body;
  const tokens = asRecord(payload?.tokens) ?? payload;

  if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken) {
    return null;
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken:
      typeof tokens.refreshToken === 'string' && tokens.refreshToken
        ? tokens.refreshToken
        : undefined,
  };
}
