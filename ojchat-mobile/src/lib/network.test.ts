import { resolveApiUrl, resetUrlCache } from './network';

describe('resolveApiUrl', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetUrlCache();
  });

  it('falls back to the public API when the development server is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Local server unavailable'));

    await expect(resolveApiUrl()).resolves.toBe(process.env.PUBLIC_API_URL);
  });
});
