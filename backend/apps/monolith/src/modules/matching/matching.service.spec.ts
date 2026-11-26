import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchingService } from './matching.service';
import { MatchmakingEngine } from './ai/matchmaking.engine';
import { CompatibilityEngine } from './ai/compatibility.engine';
import { ScamDetector } from './ai/scam.detector';
import { IcebreakerGenerator } from './ai/icebreaker.generator';
import { CandidateGenerator } from './ai/candidate.generator';
import { ToxicityDetector } from './ai/toxicity.detector';
import { FakeProfileDetector } from './ai/fake-profile.detector';
import { MatchingEnhancementService } from './matching-enhancement.service';
import {
  Block,
  Boost,
  DailyLike,
  Interest,
  Like,
  Match,
  Moment,
  MomentView,
  Notification,
  Pass,
  Photo,
  PhotoLike,
  Plan,
  Profile,
  ProfileInterest,
  ProfileView,
  Subscription,
  User,
  UserPreference,
  UserStatus,
} from '@app/common/entities';

const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';
const STRANGER_ID = '33333333-3333-3333-3333-333333333333';

const makeUser = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  fullName: `User ${id.slice(0, 4)}`,
  dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
  gender: 'female',
  status: UserStatus.ACTIVE,
  incognitoMode: false,
  ...overrides,
});

const makeProfile = (userId: string, overrides: Record<string, any> = {}) => ({
  id: `profile-${userId.slice(0, 4)}`,
  userId,
  firstName: 'Target',
  dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
  gender: 'female',
  isActive: true,
  ...overrides,
});

const repoMock = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  create: jest.fn((data: any) => ({ id: 'generated-id', ...data })),
  save: jest.fn(async (entity: any) => entity),
  remove: jest.fn(async (entity: any) => entity),
  increment: jest.fn().mockResolvedValue({ affected: 1 }),
  decrement: jest.fn().mockResolvedValue({ affected: 1 }),
  count: jest.fn().mockResolvedValue(0),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
});

describe('MatchingService swipe target validation (audit C5)', () => {
  let service: MatchingService;
  let repos: Record<string, any>;
  let eventEmitter: { emit: jest.Mock };
  let enhancementService: { trackBehavior: jest.Mock; updateEloOnMatch: jest.Mock };

  const build = async () => {
    repos = {
      User: repoMock(),
      Profile: repoMock(),
      Like: repoMock(),
      Pass: repoMock(),
      Match: repoMock(),
      DailyLike: repoMock(),
      Photo: repoMock(),
      UserPreference: repoMock(),
      Block: repoMock(),
      Interest: repoMock(),
      ProfileInterest: repoMock(),
      Boost: repoMock(),
      PhotoLike: repoMock(),
      Moment: repoMock(),
      MomentView: repoMock(),
      ProfileView: repoMock(),
      Plan: repoMock(),
      Subscription: repoMock(),
      Notification: repoMock(),
    };

    eventEmitter = { emit: jest.fn() };
    enhancementService = {
      trackBehavior: jest.fn().mockResolvedValue(undefined),
      updateEloOnMatch: jest.fn().mockResolvedValue(undefined),
    };

    const repoProviders = [
      User,
      Profile,
      Like,
      Pass,
      Match,
      DailyLike,
      Photo,
      UserPreference,
      Block,
      Interest,
      ProfileInterest,
      Boost,
      PhotoLike,
      Moment,
      MomentView,
      ProfileView,
      Plan,
      Subscription,
      Notification,
    ].map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: repos[entity.name],
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchingService,
        ...repoProviders,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: MatchmakingEngine, useValue: {} },
        {
          provide: CompatibilityEngine,
          useValue: {
            score: jest.fn().mockResolvedValue({
              overallScore: 50,
              breakdown: {},
              sharedInterests: [],
              insights: [],
            }),
          },
        },
        { provide: ScamDetector, useValue: {} },
        { provide: IcebreakerGenerator, useValue: {} },
        { provide: CandidateGenerator, useValue: {} },
        { provide: ToxicityDetector, useValue: {} },
        { provide: FakeProfileDetector, useValue: {} },
        { provide: MatchingEnhancementService, useValue: enhancementService },
      ],
    }).compile();

    service = moduleRef.get(MatchingService);
  };

  beforeEach(async () => {
    await build();

    const actor = makeUser(ACTOR_ID);
    const target = makeUser(TARGET_ID);

    repos.User.find.mockResolvedValue([actor, target]);
    repos.User.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id === ACTOR_ID) return where?.incognitoMode ? null : actor;
      if (where?.id === TARGET_ID) return target;
      return null;
    });
    repos.Profile.findOne.mockResolvedValue(makeProfile(TARGET_ID));
    repos.Block.findOne.mockResolvedValue(null);
    repos.Like.findOne.mockResolvedValue(null);
    repos.Match.findOne.mockResolvedValue(null);
    repos.Subscription.findOne.mockResolvedValue(null);
    repos.Boost.findOne.mockResolvedValue(null);
    repos.DailyLike.findOne.mockResolvedValue(null);
  });

  describe('like()', () => {
    it('rejects a target that does not exist', async () => {
      repos.User.find.mockResolvedValue([makeUser(ACTOR_ID)]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a target who blocked the caller', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repos.Like.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects a target the caller blocked', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: ACTOR_ID, blockedId: TARGET_ID });
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a banned target', async () => {
      repos.User.find.mockResolvedValue([
        makeUser(ACTOR_ID),
        makeUser(TARGET_ID, { status: UserStatus.BANNED }),
      ]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a suspended target', async () => {
      repos.User.find.mockResolvedValue([
        makeUser(ACTOR_ID),
        makeUser(TARGET_ID, { status: UserStatus.SUSPENDED }),
      ]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a caller whose account is restricted', async () => {
      repos.User.find.mockResolvedValue([
        makeUser(ACTOR_ID, { status: UserStatus.BANNED }),
        makeUser(TARGET_ID),
      ]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a target without an active profile', async () => {
      repos.Profile.findOne.mockResolvedValue(null);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a self-like', async () => {
      await expect(service.like(ACTOR_ID, ACTOR_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a malformed target id instead of hitting the database', async () => {
      await expect(service.like(ACTOR_ID, 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('creates the like, consumes quota and notifies the target', async () => {
      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toEqual({ liked: true, matched: false });
      expect(repos.Like.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ACTOR_ID, likedUserId: TARGET_ID }),
      );
      expect(repos.Like.save).toHaveBeenCalled();
      expect(repos.DailyLike.increment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'generated-id' }),
        'likesGiven',
        1,
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.send',
        expect.objectContaining({ userId: TARGET_ID, type: 'new_like' }),
      );
    });

    it('does not consume quota when the like already exists', async () => {
      // Only the caller's own like exists — there is no mutual like.
      repos.Like.findOne.mockImplementation(async ({ where }: any) =>
        where?.userId === ACTOR_ID && where?.likedUserId === TARGET_ID
          ? { id: 'like-1', userId: ACTOR_ID, likedUserId: TARGET_ID }
          : null,
      );
      repos.DailyLike.findOne.mockResolvedValue({
        id: 'dl-1',
        userId: ACTOR_ID,
        likesGiven: 10,
        superLikesGiven: 0,
      });

      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(expect.objectContaining({ id: 'like-1' }));
      expect(repos.DailyLike.increment).not.toHaveBeenCalled();
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a new like once the daily limit is reached', async () => {
      repos.DailyLike.findOne.mockResolvedValue({
        id: 'dl-1',
        userId: ACTOR_ID,
        likesGiven: 10,
        superLikesGiven: 0,
      });

      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toThrow('10/10');
      expect(repos.Like.save).not.toHaveBeenCalled();
    });
  });

  describe('pass()', () => {
    it('rejects a target that does not exist', async () => {
      repos.User.find.mockResolvedValue([makeUser(ACTOR_ID)]);
      await expect(service.pass(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(repos.Pass.save).not.toHaveBeenCalled();
    });

    it('rejects a blocked target', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.pass(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repos.Pass.save).not.toHaveBeenCalled();
    });

    it('records a pass for a valid target', async () => {
      const result = await service.pass(ACTOR_ID, TARGET_ID);
      expect(result).toEqual({ passed: true });
      expect(repos.Pass.save).toHaveBeenCalled();
    });
  });

  describe('superlike()', () => {
    it('rejects a blocked target', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.superlike(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repos.Like.save).not.toHaveBeenCalled();
    });

    it('rejects a malformed target id', async () => {
      await expect(service.superlike(ACTOR_ID, 'nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('records a super like for a valid target', async () => {
      const result = await service.superlike(ACTOR_ID, TARGET_ID);
      expect(result).toEqual({ superLiked: true, matched: false });
      expect(repos.Like.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ACTOR_ID, likedUserId: TARGET_ID, isSuperLike: true }),
      );
    });
  });
});
