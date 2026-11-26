import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

jest.mock('./users.service', () => ({
  UsersService: class UsersService {},
}));

describe('UsersController routes', () => {
  it('routes static GET endpoints before the public profile parameter route', async () => {
    const usersService = {
      getSyncDelta: jest.fn().mockResolvedValue({ data: 'sync' }),
      getVerificationStatus: jest.fn().mockResolvedValue({ status: 'none' }),
      getPublicProfile: jest.fn().mockResolvedValue({ id: 'public-profile' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.listen(0);
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the test server to listen on a TCP port');
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const syncResponse = await fetch(`${baseUrl}/sync?since=123`, {
        headers: { 'x-user-id': 'viewer-id' },
      });
      const verificationResponse = await fetch(`${baseUrl}/verification`, {
        headers: { 'x-user-id': 'viewer-id' },
      });

      expect(await syncResponse.json()).toEqual({ data: 'sync' });
      expect(await verificationResponse.json()).toEqual({ status: 'none' });
      expect(usersService.getSyncDelta).toHaveBeenCalledWith('viewer-id', 123);
      expect(usersService.getVerificationStatus).toHaveBeenCalledWith('viewer-id');
      expect(usersService.getPublicProfile).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 15000);
});
