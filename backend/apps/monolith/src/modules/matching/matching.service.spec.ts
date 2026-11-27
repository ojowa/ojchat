import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
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

/** Chainable TypeORM query-builder mock that records every fragment. */
const qbMock = (entities: any[] = []) => {
  const calls: {
    where: Array<[string, any?]>;
    andWhere: Array<[string, any?]>;
    orderBy: Array<[string, string?]>;
    innerJoin: any[][];
    addSelect: Array<[string, string?]>;
    setParameters: any[];
  } = { where: [], andWhere: [], orderBy: [], innerJoin: [], addSelect: [], setParameters: [] };

  const qb: any = {
    calls,
    where: jest.fn((sql: string, params?: any) => {
      calls.where.push([sql, params]);
      return qb;
    }),
    andWhere: jest.fn((sql: string, params?: any) => {
      calls.andWhere.push([sql, params]);
      return qb;
    }),
    orderBy: jest.fn((sql: string, dir?: string) => {
      calls.orderBy.push([sql, dir]);
      return qb;
    }),
    innerJoin: jest.fn((...args: any[]) => {
      calls.innerJoin.push(args);
      return qb;
    }),
    addSelect: jest.fn((sql: string, alias?: string) => {
      calls.addSelect.push([sql, alias]);
      return qb;
    }),
    setParameters: jest.fn((params: any) => {
      calls.setParameters.push(params);
      return qb;
    }),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn(async () => entities),
  };
  return qb;
};

describe('MatchingService swipe target validation (audit C5) + atomic swipes (C4)', () => {
  let service: MatchingService;
  let repos: Record<string, any>;
  let eventEmitter: { emit: jest.Mock };
  let enhancementService: { trackBehavior: jest.Mock; updateEloOnMatch: jest.Mock };

  // Result sets for the raw statements executed inside the transaction.
  let existingLikeRows: any[];
  let quotaRows: any[];
  let matchRows: any[];
  let currentCounterRows: any[];
  let manager: { query: jest.Mock };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };

  const sqlCalls = () => manager.query.mock.calls.map((c) => c[0] as string);

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

    existingLikeRows = [];
    quotaRows = [{ id: 'dl-1', likesGiven: 1, superLikesGiven: 0 }];
    matchRows = [];
    currentCounterRows = [{ likesGiven: 10, superLikesGiven: 0 }];

    manager = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('FOR UPDATE')) return [];
        if (sql.startsWith('SELECT "id" FROM "likes"')) return existingLikeRows;
        if (sql.includes('INSERT INTO "daily_likes"')) return quotaRows;
        if (sql.includes('INSERT INTO "likes"')) return [{ id: 'like-1' }];
        if (sql.includes('INSERT INTO "matches"')) return matchRows;
        if (sql.includes('INSERT INTO "passes"')) return [{ id: 'pass-1' }];
        if (sql.includes('SELECT "likesGiven"')) return currentCounterRows;
        return [];
      }),
    };

    dataSource = {
      transaction: jest.fn(async (cb: any) => cb(manager)),
      query: jest.fn().mockResolvedValue([]),
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
        { provide: getDataSourceToken(), useValue: dataSource },
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
    repos.Match.findOne.mockResolvedValue(null);
    repos.Subscription.findOne.mockResolvedValue(null);
    repos.Boost.findOne.mockResolvedValue(null);
    repos.DailyLike.findOne.mockResolvedValue(null);
  });

  describe('like() — target validation', () => {
    it('rejects a target that does not exist', async () => {
      repos.User.find.mockResolvedValue([makeUser(ACTOR_ID)]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a target who blocked the caller', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.query).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects a target the caller blocked', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: ACTOR_ID, blockedId: TARGET_ID });
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a banned target', async () => {
      repos.User.find.mockResolvedValue([
        makeUser(ACTOR_ID),
        makeUser(TARGET_ID, { status: UserStatus.BANNED }),
      ]);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.query).not.toHaveBeenCalled();
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
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a target without an active profile', async () => {
      repos.Profile.findOne.mockResolvedValue(null);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a self-like', async () => {
      await expect(service.like(ACTOR_ID, ACTOR_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a malformed target id instead of hitting the database', async () => {
      await expect(service.like(ACTOR_ID, 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.query).not.toHaveBeenCalled();
    });
  });

  describe('like() — atomic quota and match creation', () => {
    it('reserves the quota and inserts the like in one transaction', async () => {
      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toEqual({ liked: true, matched: false });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);

      const calls = sqlCalls();
      expect(calls.some((sql) => sql.includes('INSERT INTO "likes"'))).toBe(true);
      expect(calls.some((sql) => sql.includes('INSERT INTO "daily_likes"'))).toBe(true);

      // The quota is reserved with a single conditional upsert — no
      // read-then-write race.
      const quotaCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO "daily_likes"'),
      );
      expect(quotaCall?.[0]).toContain('ON CONFLICT ("userId", date) DO UPDATE');
      // The limit is enforced inside the same statement — no read-then-write.
      expect(quotaCall?.[0]).toContain(
        'WHERE "daily_likes"."likesGiven" + EXCLUDED."likesGiven" <= $5',
      );
    });

    it('serialises concurrent swipes by locking both participants', async () => {
      await service.like(ACTOR_ID, TARGET_ID);
      const lockCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('FOR UPDATE'),
      );
      expect(lockCall).toBeDefined();
      expect(lockCall?.[0]).toContain('ORDER BY "id"');
      expect(lockCall?.[1]).toEqual([ACTOR_ID, TARGET_ID]);
    });

    it('does not consume quota when the like already exists', async () => {
      existingLikeRows = [{ id: 'like-1' }];
      quotaRows = [];

      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toEqual({ liked: true, matched: false });
      expect(sqlCalls().some((sql) => sql.includes('INSERT INTO "daily_likes"'))).toBe(false);
      expect(sqlCalls().some((sql) => sql.includes('INSERT INTO "likes"'))).toBe(false);
    });

    it('rejects the swipe when the atomic quota reservation is refused', async () => {
      quotaRows = [];
      currentCounterRows = [{ likesGiven: 10, superLikesGiven: 0 }];

      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.like(ACTOR_ID, TARGET_ID)).rejects.toThrow('10/10');
      expect(sqlCalls().some((sql) => sql.includes('INSERT INTO "likes"'))).toBe(false);
    });

    it('creates the match when both likes exist and reports it once', async () => {
      matchRows = [{ id: 'match-1', conversationId: null }];

      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toMatchObject({ liked: true, matched: true, matchId: 'match-1' });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'match.created',
        expect.objectContaining({ matchId: 'match-1' }),
      );
      expect(enhancementService.updateEloOnMatch).toHaveBeenCalledTimes(2);
    });

    it('writes the match row in canonical order', async () => {
      matchRows = [{ id: 'match-1', conversationId: null }];

      await service.like(TARGET_ID, ACTOR_ID);

      const matchCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO "matches"'),
      );
      const [, params] = matchCall as [string, any[]];
      expect(params[0]).toBe(ACTOR_ID < TARGET_ID ? ACTOR_ID : TARGET_ID);
      expect(params[1]).toBe(ACTOR_ID < TARGET_ID ? TARGET_ID : ACTOR_ID);
    });

    it('does not create a match when the mutual like is missing', async () => {
      matchRows = [];

      const result = await service.like(ACTOR_ID, TARGET_ID);

      expect(result).toEqual({ liked: true, matched: false });
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'match.created',
        expect.anything(),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.liked', {
        likerId: ACTOR_ID,
        likedId: TARGET_ID,
      });
    });

    it('notifies the target only for a new like', async () => {
      await service.like(ACTOR_ID, TARGET_ID);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.send',
        expect.objectContaining({ userId: TARGET_ID, type: 'new_like' }),
      );

      eventEmitter.emit.mockClear();
      existingLikeRows = [{ id: 'like-1' }];
      await service.like(ACTOR_ID, TARGET_ID);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'notification.send',
        expect.anything(),
      );
    });
  });

  describe('pass()', () => {
    it('rejects a target that does not exist', async () => {
      repos.User.find.mockResolvedValue([makeUser(ACTOR_ID)]);
      await expect(service.pass(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a blocked target', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.pass(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('records a pass idempotently', async () => {
      const result = await service.pass(ACTOR_ID, TARGET_ID);
      expect(result).toEqual({ passed: true });

      const passCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO "passes"'),
      );
      expect(passCall?.[0]).toContain('ON CONFLICT DO NOTHING');
    });
  });

  describe('superlike()', () => {
    it('rejects a blocked target', async () => {
      repos.Block.findOne.mockResolvedValue({ blockerId: TARGET_ID, blockedId: ACTOR_ID });
      await expect(service.superlike(ACTOR_ID, TARGET_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('rejects a malformed target id', async () => {
      await expect(service.superlike(ACTOR_ID, 'nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reserves the super like quota and inserts the like', async () => {
      const result = await service.superlike(ACTOR_ID, TARGET_ID);
      expect(result).toEqual({ superLiked: true, matched: false });

      const quotaCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO "daily_likes"'),
      );
      expect(quotaCall?.[1]?.[2]).toBe(0); // likesGiven delta
      expect(quotaCall?.[1]?.[3]).toBe(1); // superLikesGiven delta

      const likeCall = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO "likes"'),
      );
      expect(likeCall?.[0]).toContain('true');
    });

    it('rejects when the super like limit is reached', async () => {
      quotaRows = [];
      currentCounterRows = [{ likesGiven: 0, superLikesGiven: 1 }];

      await expect(service.superlike(ACTOR_ID, TARGET_ID)).rejects.toThrow('1/1');
    });
  });

  describe('getFeed() — distance filter (audit C3 + B5)', () => {
    const ORIGIN = { lat: 6.5244, lng: 3.3792 }; // Lagos

    let qb: ReturnType<typeof qbMock>;

    const distanceClause = () =>
      qb.calls.andWhere.find(([sql]: [string, any?]) => sql.includes('ST_DWithin'));

    beforeEach(() => {
      qb = qbMock([makeUser(TARGET_ID)]);
      repos.User.createQueryBuilder = jest.fn(() => qb);

      // The viewer's own profile (the origin of the radius).
      repos.Profile.findOne.mockResolvedValue(
        makeProfile(ACTOR_ID, { latitude: ORIGIN.lat, longitude: ORIGIN.lng }),
      );
      // The candidate's profile.
      repos.Profile.find.mockResolvedValue([
        makeProfile(TARGET_ID, { latitude: 6.7, longitude: 3.38 }), // ~20 km away
      ]);
    });

    it('enforces the distance preference with an indexed ST_DWithin filter', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        ageMin: 18,
        ageMax: 50,
        maxDistanceKm: 25,
        showMe: 'everyone',
        globalDiscovery: false,
      });

      await service.getFeed(ACTOR_ID);

      const clause = distanceClause();
      expect(clause).toBeDefined();
      expect(clause?.[0]).toContain('ST_DWithin');
      // The radius is handed to the database in metres.
      expect(clause?.[1]).toMatchObject({
        originLat: ORIGIN.lat,
        originLng: ORIGIN.lng,
        radiusMeters: 25_000,
      });
    });

    it('joins the profile so the location is available to the filter', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        maxDistanceKm: 25,
        showMe: 'everyone',
      });

      await service.getFeed(ACTOR_ID);

      expect(qb.calls.innerJoin.length).toBeGreaterThan(0);
      const [entity, alias, condition] = qb.calls.innerJoin[0];
      expect(entity).toBe(Profile);
      expect(alias).toBe('p');
      expect(condition).toContain('u.id');
    });

    it('does not filter by distance when the user opted into global discovery', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        maxDistanceKm: 25,
        showMe: 'everyone',
        globalDiscovery: true,
      });

      await service.getFeed(ACTOR_ID);

      expect(distanceClause()).toBeUndefined();
    });

    it('does not filter by distance when the viewer has no location', async () => {
      repos.Profile.findOne.mockResolvedValue(makeProfile(ACTOR_ID));
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        maxDistanceKm: 25,
        showMe: 'everyone',
      });

      await service.getFeed(ACTOR_ID);

      expect(distanceClause()).toBeUndefined();
    });

    it('measures the radius from the passport location while passport mode is on', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        maxDistanceKm: 25,
        showMe: 'everyone',
        passportEnabled: true,
        passportLatitude: 9.0765,
        passportLongitude: 7.3986,
      });

      await service.getFeed(ACTOR_ID);

      expect(distanceClause()?.[1]).toMatchObject({
        originLat: 9.0765,
        originLng: 7.3986,
      });
    });

    it('orders by distance to the passport using the profile location', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        showMe: 'everyone',
        passportEnabled: true,
        passportLatitude: 9.0765,
        passportLongitude: 7.3986,
      });

      await service.getFeed(ACTOR_ID);

      // The expression is selected under an alias and ordered by that alias:
      // TypeORM resolves a raw ORDER BY expression as `alias.property`, which
      // fails for a function call.
      const [expression, alias] = qb.calls.addSelect[0];
      expect(expression).toContain('ST_Distance');
      // `users` has no latitude/longitude columns — the old query used
      // u.longitude/u.latitude and made every passport feed request fail.
      expect(expression).toContain('p."location"');
      expect(expression).not.toContain('u.longitude');
      expect(expression).not.toContain('u.latitude');
      expect(alias).toBe('passport_distance');
      expect(qb.calls.orderBy[0]?.[0]).toBe('passport_distance');
      expect(qb.calls.orderBy[0]?.[1]).toBe('ASC');
    });

    it('returns a coarse distance bucket and never the exact coordinates', async () => {
      repos.UserPreference.findOne.mockResolvedValue({
        userId: ACTOR_ID,
        maxDistanceKm: 50,
        showMe: 'everyone',
      });

      const result = await service.getFeed(ACTOR_ID);

      expect(result.candidates).toHaveLength(1);
      const profile = result.candidates[0].profile;
      expect(profile?.distance).toBe('10-25 km');
      expect(profile).not.toHaveProperty('latitude');
      expect(profile).not.toHaveProperty('longitude');
    });
  });
});
