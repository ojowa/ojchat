import { parseAuthTokenResponse } from './authTokenResponse';

describe('parseAuthTokenResponse', () => {
  it('reads tokens from the backend response envelope', () => {
    expect(
      parseAuthTokenResponse({
        success: true,
        data: {
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          },
        },
      }),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('accepts a flat token response', () => {
    expect(
      parseAuthTokenResponse({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('rejects responses without an access token', () => {
    expect(parseAuthTokenResponse({ data: { tokens: {} } })).toBeNull();
  });
});
