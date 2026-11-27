import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, MoreThan, LessThan, IsNull, DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
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
  UserStatus,
} from '@app/common/entities';
import { redactProfile, redactUserSummary } from '@app/common/privacy';
import { MatchmakingEngine } from './ai/matchmaking.engine';
import { CompatibilityEngine } from './ai/compatibility.engine';
import { ScamDetector } from './ai/scam.detector';
import { IcebreakerGenerator } from './ai/icebreaker.generator';
import { CandidateGenerator } from './ai/candidate.generator';
import { ToxicityDetector } from './ai/toxicity.detector';
import { FakeProfileDetector } from './ai/fake-profile.detector';
import { MatchingEnhancementService } from './matching-enhancement.service';

/**
 * Account states that must not be able to act on the platform, and whose
 * profiles must not be reachable.
 *
 * `PENDING_VERIFICATION` is deliberately excluded: registration creates the
 * account in that state and only the email OTP promotes it to `ACTIVE`, so
 * treating it as restricted would lock out legitimately registered accounts
 * that have not completed verification yet.
 */
const RESTRICTED_STATUSES = new Set<UserStatus>([
  UserStatus.SUSPENDED,
  UserStatus.BANNED,
  UserStatus.DEACTIVATED,
]);

@Injectable()
export class MatchingService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Profile) private profileRepo: Repository<Profile>,
    @InjectRepository(Like) private likeRepo: Repository<Like>,
    @InjectRepository(Pass) private passRepo: Repository<Pass>,
    @InjectRepository(Match) private matchRepo: Repository<Match>,
    @InjectRepository(DailyLike) private dailyLikeRepo: Repository<DailyLike>,
    @InjectRepository(Photo) private photoRepo: Repository<Photo>,
    @InjectRepository(UserPreference) private prefRepo: Repository<UserPreference>,
    @InjectRepository(Block) private blockRepo: Repository<Block>,
    @InjectRepository(Interest) private interestRepo: Repository<Interest>,
    @InjectRepository(ProfileInterest) private profileInterestRepo: Repository<ProfileInterest>,
    @InjectRepository(Boost) private boostRepo: Repository<Boost>,
    @InjectRepository(PhotoLike) private photoLikeRepo: Repository<PhotoLike>,
    @InjectRepository(Moment) private momentRepo: Repository<Moment>,
    @InjectRepository(MomentView) private momentViewRepo: Repository<MomentView>,
    @InjectRepository(ProfileView) private profileViewRepo: Repository<ProfileView>,
    @InjectRepository(Plan) private planRepo: Repository<Plan>,
    @InjectRepository(Subscription) private subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectDataSource() private dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly matchmakingEngine: MatchmakingEngine,
    private readonly compatibilityEngine: CompatibilityEngine,
    private readonly scamDetector: ScamDetector,
    private readonly icebreakerGenerator: IcebreakerGenerator,
    private readonly candidateGenerator: CandidateGenerator,
    private readonly toxicityDetector: ToxicityDetector,
    private readonly fakeProfileDetector: FakeProfileDetector,
    private readonly enhancementService: MatchingEnhancementService,
  ) {}

  private validateUserId(userId: string) {
    if (
      !userId ||
      userId === '' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ) {
      throw new BadRequestException('Valid user ID is required');
    }
  }

  /**
   * Validate the target of a swipe (like / pass / super like) before any row
   * is written.
   *
   * Without this check any caller could `POST /matching/like/<any-id>` and
   * create likes/passes for users who blocked them, who are suspended or
   * deleted, or who do not exist at all — orphan rows, notification spam and a
   * direct-API way around the product's visibility rules (audit C5).
   *
   * Discovery preferences (age range, gender, "verified only", …) are
   * deliberately NOT enforced here: they are discovery filters, not access
   * control, and rejecting them would break the legitimate
   * "search a person -> open their profile -> like them" flow. Two-way
   * preference filtering is handled separately (audit item #9).
   */
  private async validateSwipeTarget(actorId: string, targetId: string): Promise<void> {
    this.validateUserId(actorId);
    this.validateUserId(targetId);

    if (actorId === targetId) {
      throw new BadRequestException('Cannot interact with yourself');
    }

    // One round trip for both parties.
    const users = await this.userRepo.find({ where: { id: In([actorId, targetId]) } });
    const actor = users.find((u) => u.id === actorId);
    const target = users.find((u) => u.id === targetId);

    if (!actor) throw new NotFoundException('User not found');
    if (!target) throw new NotFoundException('This user no longer exists');

    // A restricted account cannot act on the platform.
    if (RESTRICTED_STATUSES.has(actor.status)) {
      throw new ForbiddenException('Your account is not active');
    }

    // The target must still be reachable.
    if (RESTRICTED_STATUSES.has(target.status)) {
      throw new ForbiddenException('This profile is not available');
    }

    // A block in either direction ends all interaction — in particular you
    // cannot like or pass someone who blocked you.
    const block = await this.blockRepo.findOne({
      where: [
        { blockerId: actorId, blockedId: targetId },
        { blockerId: targetId, blockedId: actorId },
      ],
    });
    if (block) {
      throw new ForbiddenException('You cannot interact with this user');
    }

    // There has to be an active profile to swipe on.
    const profile = await this.profileRepo.findOne({ where: { userId: targetId } });
    if (!profile || !profile.isActive) {
      throw new NotFoundException('This profile is not available');
    }
  }

  async getUserPlanInfo(userId: string) {
    const subscription = await this.subscriptionRepo.findOne({
      where: { userId, status: 'active' },
      relations: ['plan'],
    });
    const plan = subscription?.plan;
    const dailyLikesLimit = plan?.dailyLikes ?? 10;
    const dailySuperLikesLimit = plan?.dailySuperLikes ?? 1;

    const today = new Date().toISOString().split('T')[0];
    const dailyLike = await this.dailyLikeRepo.findOne({ where: { userId, date: today as any } });

    return {
      planId: plan?.name || 'free',
      planName: plan?.displayName || 'Free',
      dailyLikes: dailyLike?.likesGiven ?? 0,
      dailyLikesLimit,
      dailySuperLikes: dailyLike?.superLikesGiven ?? 0,
      dailySuperLikesLimit,
      isPremium: !!subscription && subscription.status === 'active' && plan?.name !== 'free',
      hasBoost: !!(await this.boostRepo.findOne({
        where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
      })),
      hasIncognito: !!(await this.userRepo.findOne({ where: { id: userId, incognitoMode: true } })),
    };
  }

  async getFeed(userId: string, page = 1, limit = 20) {
    this.validateUserId(userId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const likedIds = (await this.likeRepo.find({ where: { userId } })).map((l) => l.likedUserId);
    const passedIds = (await this.passRepo.find({ where: { userId } })).map((p) => p.passedUserId);
    const blockedByMe = (await this.blockRepo.find({ where: { blockerId: userId } })).map(
      (b) => b.blockedId,
    );
    const blockedMe = (await this.blockRepo.find({ where: { blockedId: userId } })).map(
      (b) => b.blockerId,
    );
    const excludeIds = [userId, ...likedIds, ...passedIds, ...blockedByMe, ...blockedMe];

    const pref = await this.prefRepo.findOne({ where: { userId } });
    const ageMin = pref?.ageMin ?? 18;
    const ageMax = pref?.ageMax ?? 50;
    const now = new Date();
    const maxDobStr = `${now.getFullYear() - ageMin}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const minDobStr = `${now.getFullYear() - ageMax - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.id NOT IN (:...excludeIds)', { excludeIds })
      .andWhere('u.status = :status', { status: 'active' })
      .andWhere('u.dateOfBirth <= :maxDob', { maxDob: maxDobStr })
      .andWhere('u.dateOfBirth >= :minDob', { minDob: minDobStr })
      .andWhere('u.incognitoMode = :incognito', { incognito: false });

    if (pref?.showMe && pref.showMe !== 'everyone') {
      qb = qb.andWhere('u.gender = :gender', { gender: pref.showMe });
    }

    const sub = await this.subscriptionRepo.findOne({
      where: { userId, status: 'active' },
      relations: ['plan'],
    });
    const isPremium = !!sub && sub.plan?.name !== 'free';

    if (pref?.showVerifiedOnly && isPremium) {
      const verifiedUserIds = (
        await this.profileRepo.find({ where: { verified: true }, select: ['userId'] })
      ).map((p) => p.userId);
      if (verifiedUserIds.length > 0) {
        qb = qb.andWhere('u.id IN (:...verifiedIds)', { verifiedIds: verifiedUserIds });
      } else {
        qb = qb.andWhere('1 = 0');
      }
    }

    if (pref?.relationshipGoal && pref.relationshipGoal !== 'any' && isPremium) {
      const rgUserIds = (
        await this.profileRepo.find({
          where: { relationshipGoal: pref.relationshipGoal },
          select: ['userId'],
        })
      ).map((p) => p.userId);
      if (rgUserIds.length > 0) {
        qb = qb.andWhere('u.id IN (:...rgIds)', { rgIds: rgUserIds });
      } else {
        qb = qb.andWhere('1 = 0');
      }
    }

    if (pref?.showProfilesWithPhotosOnly && isPremium) {
      const photoUserIds = (
        await this.photoRepo
          .createQueryBuilder('p')
          .innerJoin('p.profile', 'prof')
          .select('prof.userId')
          .getRawMany()
      ).map((r: any) => r.userId);
      if (photoUserIds.length > 0) {
        qb = qb.andWhere('u.id IN (:...photoUserIds)', { photoUserIds });
      } else {
        qb = qb.andWhere('1 = 0');
      }
    }

    if (pref?.passportEnabled && pref.passportLatitude != null && pref.passportLongitude != null) {
      qb = qb.orderBy(
        `ST_Distance(
          ST_SetSRID(ST_MakePoint(u.longitude, u.latitude), 4326)::geography,
          ST_SetSRID(ST_MakePoint(:passportLng, :passportLat), 4326)::geography
        )`,
        'ASC',
      );
      qb.setParameters({ passportLng: pref.passportLongitude, passportLat: pref.passportLatitude });
    }

    const activeBoost = await this.boostRepo.findOne({
      where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
    });

    const users = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const userIds = users.map((u) => u.id);
    const boostedUserIds = activeBoost
      ? (
          await this.boostRepo.find({
            where: { isActive: true, expiresAt: MoreThan(new Date()) },
            select: ['userId'],
          })
        ).map((b) => b.userId)
      : [];

    const sortedUserIds = [...userIds].sort((a, b) => {
      const aBoosted = boostedUserIds.includes(a) ? 1 : 0;
      const bBoosted = boostedUserIds.includes(b) ? 1 : 0;
      return bBoosted - aBoosted;
    });

    const profiles =
      sortedUserIds.length > 0
        ? await this.profileRepo.find({ where: { userId: In(sortedUserIds) } })
        : [];
    const profileIds = profiles.map((p) => p.id);
    const photos =
      profileIds.length > 0
        ? await this.photoRepo.find({
            where: { profileId: In(profileIds) },
            order: { order: 'ASC' },
          })
        : [];
    const profileInterests =
      profileIds.length > 0
        ? await this.profileInterestRepo.find({ where: { profileId: In(profileIds) } })
        : [];
    const interestIds = [...new Set(profileInterests.map((pi) => pi.interestId))];
    const interests =
      interestIds.length > 0
        ? await this.interestRepo.find({ where: { id: In(interestIds) } })
        : [];

    const myProfileRecord = await this.profileRepo.findOne({ where: { userId } });
    const myInterestIds = new Set(
      profileInterests
        .filter((pi) => pi.profileId === myProfileRecord?.id)
        .map((pi) => pi.interestId),
    );

    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const photoMap = new Map<string, Photo[]>();
    for (const photo of photos) {
      const list = photoMap.get(photo.profileId) || [];
      list.push(photo);
      photoMap.set(photo.profileId, list);
    }
    const interestMap = new Map<string, { id: string; name: string; category?: string }[]>();
    for (const pi of profileInterests) {
      const interest = interests.find((i) => i.id === pi.interestId);
      if (interest) {
        const list = interestMap.get(pi.profileId) || [];
        list.push({ id: interest.id, name: interest.name, category: interest.category });
        interestMap.set(pi.profileId, list);
      }
    }

    const candidates = sortedUserIds
      .filter((uid) => profileMap.has(uid)) // skip users with no profile row (unshowable)
      .map((uid) => {
        const u = users.find((usr) => usr.id === uid)!;
        const profile = profileMap.get(u.id);
        const profilePhotos = profile ? photoMap.get(profile.id) || [] : [];
        const profileInterestsList = profile ? interestMap.get(profile.id) || [] : [];
        return {
          // Privacy (C2): the client gets age, never the exact date of birth,
          // and never the raw profile entity (which carries exact GPS
          // coordinates, employer and school).
          user: redactUserSummary(u),
          profile: profile
            ? redactProfile(profile, {
                photos: profilePhotos,
                interests: profileInterestsList,
              })
            : null,
        };
      });

    const enriched = await Promise.all(
      candidates.map(async (c) => {
        try {
          const compatibility = await this.compatibilityEngine.score(userId, c.user.id);
          const overallScore = await this.enhancementService.calculateOverallScore(
            userId,
            c.user.id,
            compatibility.overallScore,
          );
          return { ...c, compatibility, overallScore };
        } catch {
          return c;
        }
      }),
    );

    const candidateUserIds = enriched.map((c) => c.user.id);
    const candidateSubs =
      candidateUserIds.length > 0
        ? await this.subscriptionRepo.find({
            where: candidateUserIds.map((id) => ({ userId: id, status: 'active' })),
            relations: ['plan'],
          })
        : [];
    const planTierMap = new Map<string, number>();
    for (const sub of candidateSubs) {
      const tier =
        sub.plan?.name === 'platinum'
          ? 4
          : sub.plan?.name === 'gold'
            ? 3
            : sub.plan?.name === 'premium'
              ? 2
              : 1;
      planTierMap.set(sub.userId, tier);
    }

    enriched.sort((a, b) => {
      const aBoosted = boostedUserIds.includes(a.user.id) ? 1 : 0;
      const bBoosted = boostedUserIds.includes(b.user.id) ? 1 : 0;
      if (aBoosted !== bBoosted) return bBoosted - aBoosted;

      const aInterestOverlap =
        myInterestIds.size > 0
          ? (a.profile?.interests?.filter((i: any) => myInterestIds.has(i.id)).length || 0) /
            myInterestIds.size
          : 0;
      const bInterestOverlap =
        myInterestIds.size > 0
          ? (b.profile?.interests?.filter((i: any) => myInterestIds.has(i.id)).length || 0) /
            myInterestIds.size
          : 0;

      const aPlanBonus = (planTierMap.get(a.user.id) || 0) * 0.03;
      const bPlanBonus = (planTierMap.get(b.user.id) || 0) * 0.03;

      const aScore = ((a as any).overallScore || 0) + aInterestOverlap * 0.15 + aPlanBonus;
      const bScore = ((b as any).overallScore || 0) + bInterestOverlap * 0.15 + bPlanBonus;
      return bScore - aScore;
    });

    return {
      candidates: enriched,
      meta: { page, limit, hasMore: users.length === limit },
    };
  }

  /**
   * Serialise concurrent swipes between the same two users.
   *
   * The mutual-like detection needs both like rows to be visible at the same
   * time. Without a lock, A and B can each insert their like and each check
   * for the other's like *before* the other side commits — both see a
   * half-state, neither creates the match and the "It's a Match!" is silently
   * lost. Locking both participant rows (in a deterministic order, so no
   * deadlock) means the second transaction only proceeds once the first has
   * committed, and therefore always sees both likes.
   */
  private async lockSwipeParticipants(
    manager: EntityManager,
    userId: string,
    targetId: string,
  ): Promise<void> {
    await manager.query(
      `SELECT "id" FROM "users" WHERE "id" IN ($1, $2) ORDER BY "id" FOR UPDATE`,
      [userId, targetId],
    );
  }

  /**
   * Atomically reserve one unit of the daily swipe quota.
   *
   * The old implementation read the counter, compared it with the plan limit
   * and incremented it in three separate statements: two concurrent swipes
   * could both pass the check and both increment, so the plan limit was
   * exceeded. Worse, the create-if-missing path raced on the
   * (userId, date) uniqueness and produced an unhandled 500.
   *
   * This is a single statement: the row is created or updated, and the update
   * only happens while the counter is still below the limit. When the limit
   * is reached no row is returned and the caller gets a 400.
   */
  private async consumeSwipeQuota(
    manager: EntityManager,
    userId: string,
    kind: 'like' | 'superlike',
    limits: { dailyLikesLimit: number; dailySuperLikesLimit: number },
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const likesDelta = kind === 'like' ? 1 : 0;
    const superLikesDelta = kind === 'superlike' ? 1 : 0;

    const rows = await manager.query(
      `INSERT INTO "daily_likes" ("userId", date, "likesGiven", "superLikesGiven")
       SELECT $1::varchar, $2::date, $3::int, $4::int
       WHERE $3::int <= $5::int AND $4::int <= $6::int
       ON CONFLICT ("userId", date) DO UPDATE
         SET "likesGiven" = "daily_likes"."likesGiven" + EXCLUDED."likesGiven",
             "superLikesGiven" = "daily_likes"."superLikesGiven" + EXCLUDED."superLikesGiven"
       WHERE "daily_likes"."likesGiven" + EXCLUDED."likesGiven" <= $5::int
         AND "daily_likes"."superLikesGiven" + EXCLUDED."superLikesGiven" <= $6::int
       RETURNING "id", "likesGiven", "superLikesGiven"`,
      [
        userId,
        today,
        likesDelta,
        superLikesDelta,
        limits.dailyLikesLimit,
        limits.dailySuperLikesLimit,
      ],
    );

    if (!rows.length) {
      const current = await manager.query(
        `SELECT "likesGiven", "superLikesGiven" FROM "daily_likes" WHERE "userId" = $1 AND date = $2`,
        [userId, today],
      );
      const likesGiven = current[0]?.likesGiven ?? 0;
      const superLikesGiven = current[0]?.superLikesGiven ?? 0;

      if (kind === 'superlike') {
        throw new BadRequestException(
          `Daily super like limit reached (${superLikesGiven}/${limits.dailySuperLikesLimit}). Upgrade your plan for more super likes.`,
        );
      }
      throw new BadRequestException(
        `Daily like limit reached (${likesGiven}/${limits.dailyLikesLimit}). Upgrade your plan for more likes.`,
      );
    }
  }

  /**
   * Create the match between two users — atomically and at most once.
   *
   * The insert only happens when BOTH like rows exist, and it is a no-op when
   * the match already exists (the canonical unique index turns the second
   * concurrent insert into a no-op instead of a duplicate match row with a
   * duplicate conversation and duplicate notifications).
   */
  private async createMatchIfMutual(
    manager: EntityManager,
    userAId: string,
    userBId: string,
  ): Promise<{ id: string; conversationId: string | null } | null> {
    // Canonical order — the row is always stored with the smaller id first.
    const [user1Id, user2Id] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

    const rows = await manager.query(
      `INSERT INTO "matches" ("user1Id", "user2Id", "matchedAt", "isActive", "matchedVia")
       SELECT $1::varchar, $2::varchar, NOW(), true, 'like'
       WHERE EXISTS (SELECT 1 FROM "likes" WHERE "userId" = $2::varchar AND "likedUserId" = $1::varchar)
         AND EXISTS (SELECT 1 FROM "likes" WHERE "userId" = $1::varchar AND "likedUserId" = $2::varchar)
       ON CONFLICT DO NOTHING
       RETURNING "id", "conversationId"`,
      [user1Id, user2Id],
    );

    return rows[0] ?? null;
  }

  async like(likerId: string, likedId: string) {
    await this.validateSwipeTarget(likerId, likedId);

    const planInfo = await this.getUserPlanInfo(likerId);

    // Quota reservation, like insert and mutual-match detection happen in one
    // transaction: either the swipe is recorded (and counted) or nothing
    // happens. No read-then-write race, no lost match.
    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.lockSwipeParticipants(manager, likerId, likedId);

      const existing = await manager.query(
        `SELECT "id" FROM "likes" WHERE "userId" = $1 AND "likedUserId" = $2`,
        [likerId, likedId],
      );
      const isNewLike = existing.length === 0;

      if (isNewLike) {
        await this.consumeSwipeQuota(manager, likerId, 'like', planInfo);
        await manager.query(
          `INSERT INTO "likes" ("userId", "likedUserId", "isSuperLike", "createdAt")
           VALUES ($1::varchar, $2::varchar, false, NOW())
           ON CONFLICT DO NOTHING`,
          [likerId, likedId],
        );
      }

      const match = await this.createMatchIfMutual(manager, likerId, likedId);
      return { isNewLike, match };
    });

    if (outcome.match) {
      await this.enhancementService.updateEloOnMatch(likerId);
      await this.enhancementService.updateEloOnMatch(likedId);
      this.eventEmitter.emit('match.created', {
        matchId: outcome.match.id,
        user1Id: likerId,
        user2Id: likedId,
      });
      const updatedMatch = await this.matchRepo.findOne({ where: { id: outcome.match.id } });
      return {
        liked: true,
        matched: true,
        matchId: outcome.match.id,
        conversationId: updatedMatch?.conversationId,
      };
    }

    if (outcome.isNewLike) {
      const likedUser = await this.userRepo.findOne({ where: { id: likedId } });
      try {
        await this.enhancementService.trackBehavior({
          userId: likerId,
          targetUserId: likedId,
          action: 'like',
          targetAge: likedUser?.dateOfBirth
            ? Math.floor(
                (Date.now() - new Date(likedUser.dateOfBirth).getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000),
              )
            : undefined,
          targetGender: likedUser?.gender,
        });
      } catch (_) {}

      this.eventEmitter.emit('user.liked', { likerId, likedId });
      const liker = await this.userRepo.findOne({ where: { id: likerId } });
      this.eventEmitter.emit('notification.send', {
        userId: likedId,
        type: 'new_like',
        title: 'New Like',
        body: `${liker?.fullName || 'Someone'} liked your profile`,
        data: { likerId },
      });
    }

    return { liked: true, matched: false };
  }

  async pass(passerId: string, passedId: string) {
    await this.validateSwipeTarget(passerId, passedId);

    // Idempotent insert — the unique index on (userId, passedUserId) turns a
    // duplicate pass into a no-op instead of a unique-violation error.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "passes" ("userId", "passedUserId", "createdAt")
         VALUES ($1::varchar, $2::varchar, NOW())
         ON CONFLICT DO NOTHING`,
        [passerId, passedId],
      );
    });

    const passedUser = await this.userRepo.findOne({ where: { id: passedId } });
    await this.enhancementService.trackBehavior({
      userId: passerId,
      targetUserId: passedId,
      action: 'pass',
      targetAge: passedUser?.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(passedUser.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          )
        : undefined,
      targetGender: passedUser?.gender,
    });

    return { passed: true };
  }

  async superlike(likerId: string, likedId: string) {
    await this.validateSwipeTarget(likerId, likedId);

    const planInfo = await this.getUserPlanInfo(likerId);

    // Same transactional flow as like() — see the comment there.
    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.lockSwipeParticipants(manager, likerId, likedId);

      const existing = await manager.query(
        `SELECT "id" FROM "likes" WHERE "userId" = $1 AND "likedUserId" = $2`,
        [likerId, likedId],
      );
      const isNewLike = existing.length === 0;

      if (isNewLike) {
        await this.consumeSwipeQuota(manager, likerId, 'superlike', planInfo);
        await manager.query(
          `INSERT INTO "likes" ("userId", "likedUserId", "isSuperLike", "createdAt")
           VALUES ($1::varchar, $2::varchar, true, NOW())
           ON CONFLICT DO NOTHING`,
          [likerId, likedId],
        );
      }

      const match = await this.createMatchIfMutual(manager, likerId, likedId);
      return { isNewLike, match };
    });

    if (outcome.match) {
      await this.enhancementService.updateEloOnMatch(likerId);
      await this.enhancementService.updateEloOnMatch(likedId);
      this.eventEmitter.emit('match.created', {
        matchId: outcome.match.id,
        user1Id: likerId,
        user2Id: likedId,
      });
      const updatedMatch = await this.matchRepo.findOne({ where: { id: outcome.match.id } });
      return {
        superLiked: true,
        matched: true,
        matchId: outcome.match.id,
        conversationId: updatedMatch?.conversationId,
      };
    }

    if (outcome.isNewLike) {
      const likedUser = await this.userRepo.findOne({ where: { id: likedId } });
      try {
        await this.enhancementService.trackBehavior({
          userId: likerId,
          targetUserId: likedId,
          action: 'super_like',
          targetAge: likedUser?.dateOfBirth
            ? Math.floor(
                (Date.now() - new Date(likedUser.dateOfBirth).getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000),
              )
            : undefined,
          targetGender: likedUser?.gender,
        });
      } catch (_) {}

      this.eventEmitter.emit('user.super_liked', { likerId, likedId });
      const superLiker = await this.userRepo.findOne({ where: { id: likerId } });
      this.eventEmitter.emit('notification.send', {
        userId: likedId,
        type: 'super_like',
        title: 'Super Like!',
        body: `${superLiker?.fullName || 'Someone'} super liked you!`,
        data: { likerId },
      });
    }

    return { superLiked: true, matched: false };
  }

  /**
   * Give one unit of quota back (undo / rewind). The counter can never go
   * below zero — a blind decrement could otherwise hand out free likes.
   */
  private async decrementSwipeCounter(
    userId: string,
    date: string,
    column: 'likesGiven' | 'superLikesGiven',
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "daily_likes"
       SET "${column}" = GREATEST(0, "${column}" - 1)
       WHERE "userId" = $1 AND date = $2`,
      [userId, date],
    );
  }

  async undo(userId: string) {
    const lastLike = await this.likeRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const lastPass = await this.passRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (!lastLike && !lastPass) throw new NotFoundException('No action to undo');

    if (lastLike && (!lastPass || lastLike.createdAt > lastPass.createdAt)) {
      await this.likeRepo.remove(lastLike);
      await this.decrementSwipeCounter(
        userId,
        lastLike.createdAt.toISOString().split('T')[0],
        lastLike.isSuperLike ? 'superLikesGiven' : 'likesGiven',
      );
      return { undone: true, action: 'like' };
    }

    if (lastPass) {
      await this.passRepo.remove(lastPass);
      return { undone: true, action: 'pass' };
    }

    throw new NotFoundException('No action to undo');
  }

  async rewind(userId: string) {
    const planInfo = await this.getUserPlanInfo(userId);
    if (!planInfo.isPremium)
      throw new BadRequestException('Rewind is a premium feature. Upgrade to unlock.');

    const lastLikes = await this.likeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    const lastPasses = await this.passRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    if (lastLikes.length === 0 && lastPasses.length === 0)
      throw new NotFoundException('No actions to rewind');

    const allActions = [
      ...lastLikes.map((l) => ({
        type: 'like' as const,
        date: l.createdAt,
        isSuperLike: l.isSuperLike,
      })),
      ...lastPasses.map((p) => ({ type: 'pass' as const, date: p.createdAt })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const actionsToUndo = allActions.slice(0, 5);
    let likesRemoved = 0;
    let passesRemoved = 0;

    for (const action of actionsToUndo) {
      if (action.type === 'like') {
        const like = lastLikes.find((l) => l.createdAt.getTime() === action.date.getTime());
        if (like) {
          await this.likeRepo.remove(like);
          const dateStr = like.createdAt.toISOString().split('T')[0];
          await this.decrementSwipeCounter(
            userId,
            dateStr,
            like.isSuperLike ? 'superLikesGiven' : 'likesGiven',
          );
          likesRemoved++;
        }
      } else {
        const pass = lastPasses.find((p) => p.createdAt.getTime() === action.date.getTime());
        if (pass) {
          await this.passRepo.remove(pass);
          passesRemoved++;
        }
      }
    }

    return { rewound: true, likesRemoved, passesRemoved, total: likesRemoved + passesRemoved };
  }

  async activateBoost(userId: string) {
    const planInfo = await this.getUserPlanInfo(userId);
    if (!planInfo.isPremium)
      throw new BadRequestException('Boost is a premium feature. Upgrade to unlock.');

    const existingActive = await this.boostRepo.findOne({
      where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
    });
    if (existingActive) throw new BadRequestException('Boost is already active');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const boostsThisMonth = await this.boostRepo.count({
      where: { userId, activeAt: MoreThan(monthStart) },
    });

    const maxBoosts = planInfo.planId === 'platinum' ? 999 : planInfo.planId === 'gold' ? 3 : 0;
    if (boostsThisMonth >= maxBoosts) {
      throw new BadRequestException(
        `Monthly boost limit reached (${maxBoosts}/${maxBoosts}). ${planInfo.planId === 'gold' ? 'Upgrade to Platinum for unlimited boosts.' : ''}`,
      );
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    const boost = this.boostRepo.create({
      userId,
      durationMinutes: 30,
      expiresAt,
      isActive: true,
    });
    await this.boostRepo.save(boost);

    this.eventEmitter.emit('boost.activated', { userId, boostId: boost.id });
    return { activated: true, expiresAt, boostId: boost.id };
  }

  async getBoostStatus(userId: string) {
    const activeBoost = await this.boostRepo.findOne({
      where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
    });

    const totalBoosts = await this.boostRepo.count({ where: { userId } });

    return {
      activeBoost: activeBoost
        ? {
            id: activeBoost.id,
            expiresAt: activeBoost.expiresAt,
            viewsGained: activeBoost.viewsGained,
            likesGained: activeBoost.likesGained,
          }
        : null,
      totalBoosts,
    };
  }

  async toggleIncognito(userId: string) {
    const planInfo = await this.getUserPlanInfo(userId);
    if (!planInfo.isPremium)
      throw new BadRequestException('Incognito mode is a premium feature. Upgrade to unlock.');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    user.incognitoMode = !user.incognitoMode;
    await this.userRepo.save(user);

    return { incognitoMode: user.incognitoMode };
  }

  async updatePassport(userId: string, latitude: number, longitude: number, enabled: boolean) {
    const planInfo = await this.getUserPlanInfo(userId);
    if (!planInfo.isPremium)
      throw new BadRequestException('Passport is a premium feature. Upgrade to unlock.');

    let pref = await this.prefRepo.findOne({ where: { userId } });
    if (!pref) {
      pref = this.prefRepo.create({ userId });
    }

    pref.passportLatitude = latitude;
    pref.passportLongitude = longitude;
    pref.passportEnabled = enabled;
    await this.prefRepo.save(pref);

    return {
      passportEnabled: pref.passportEnabled,
      passportLatitude: pref.passportLatitude,
      passportLongitude: pref.passportLongitude,
    };
  }

  async likePhoto(userId: string, photoId: string, profileId: string) {
    const existing = await this.photoLikeRepo.findOne({ where: { userId, photoId } });
    if (existing) throw new BadRequestException('Already liked this photo');

    const photoLike = this.photoLikeRepo.create({ userId, photoId, profileId });
    await this.photoLikeRepo.save(photoLike);

    return { liked: true, photoId };
  }

  async getPhotoStats(userId: string) {
    const photoLikes = await this.photoLikeRepo.find({ where: { userId } });

    const photoCounts = new Map<string, number>();
    for (const pl of photoLikes) {
      photoCounts.set(pl.photoId, (photoCounts.get(pl.photoId) || 0) + 1);
    }

    const totalLikes = photoLikes.length;

    return {
      totalLikes,
      photos: Array.from(photoCounts.entries()).map(([photoId, count]) => ({ photoId, count })),
    };
  }

  async getMatches(userId: string, page = 1, limit = 20) {
    const [matches, total] = await this.matchRepo.findAndCount({
      where: [
        { user1Id: userId, isActive: true },
        { user2Id: userId, isActive: true },
      ],
      order: { matchedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const otherUserIds = matches.map((m) => (m.user1Id === userId ? m.user2Id : m.user1Id));
    const otherUsers =
      otherUserIds.length > 0 ? await this.userRepo.find({ where: { id: In(otherUserIds) } }) : [];
    const userMap = new Map(otherUsers.map((u) => [u.id, u]));

    const otherProfiles =
      otherUserIds.length > 0
        ? await this.profileRepo.find({ where: { userId: In(otherUserIds) } })
        : [];
    const profileMap = new Map(otherProfiles.map((p) => [p.userId, p]));
    const profileIds = otherProfiles.map((p) => p.id);
    const photos =
      profileIds.length > 0
        ? await this.photoRepo.find({
            where: { profileId: In(profileIds) },
            order: { order: 'ASC' },
          })
        : [];
    const photoMap = new Map<string, Photo[]>();
    for (const photo of photos) {
      const list = photoMap.get(photo.profileId) || [];
      list.push(photo);
      photoMap.set(photo.profileId, list);
    }

    return {
      matches: matches.map((m) => {
        const otherId = m.user1Id === userId ? m.user2Id : m.user1Id;
        const otherUser = userMap.get(otherId);
        const profile = profileMap.get(otherId);
        const profilePhotos = profile ? photoMap.get(profile.id) || [] : [];
        return {
          id: m.id,
          user1Id: m.user1Id,
          user2Id: m.user2Id,
          matchedAt: m.matchedAt,
          matchedVia: m.matchedVia,
          conversationId: m.conversationId,
          otherUser: otherUser
            ? {
                id: otherUser.id,
                fullName: otherUser.fullName,
                avatarUrl:
                  profilePhotos.find((p) => p.isPrimary)?.url || profilePhotos[0]?.url || null,
                photos: profilePhotos.map((p) => ({
                  id: p.id,
                  url: p.url,
                  isPrimary: p.isPrimary,
                  order: p.order,
                })),
              }
            : null,
        };
      }),
      meta: { page, limit, total, hasMore: total > page * limit },
    };
  }

  async unmatch(userId: string, matchId: string) {
    const match = await this.matchRepo.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');
    if (match.user1Id !== userId && match.user2Id !== userId)
      throw new BadRequestException('Not your match');
    await this.matchRepo.update(matchId, { isActive: false });
    return { unmatched: true };
  }

  async getLikedYou(userId: string, page = 1, limit = 20) {
    const planInfo = await this.getUserPlanInfo(userId);
    const allLikes = await this.likeRepo.find({
      where: { likedUserId: userId },
      order: { createdAt: 'DESC' },
    });

    if (allLikes.length === 0) {
      return { likes: [], total: 0, isBlurred: false };
    }

    const matchedLikes = await this.matchRepo.find({
      where: [
        { user1Id: userId, isActive: true },
        { user2Id: userId, isActive: true },
      ],
    });
    const matchedIds = new Set(matchedLikes.flatMap((m) => [m.user1Id, m.user2Id]));
    const pendingLikes = allLikes.filter((l) => !matchedIds.has(l.userId));
    const total = pendingLikes.length;
    const isBlurred = !planInfo.isPremium;

    if (isBlurred) {
      return { likes: [], total, isBlurred: true };
    }

    const paginatedLikes = pendingLikes.slice((page - 1) * limit, page * limit);
    const paginatedLikerIds = paginatedLikes.map((l) => l.userId);

    const likers =
      paginatedLikerIds.length > 0
        ? await this.userRepo.find({ where: { id: In(paginatedLikerIds) } })
        : [];
    const userMap = new Map(likers.map((u) => [u.id, u]));
    const profiles =
      paginatedLikerIds.length > 0
        ? await this.profileRepo.find({ where: { userId: In(paginatedLikerIds) } })
        : [];
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const profileIds = profiles.map((p) => p.id);
    const photos =
      profileIds.length > 0
        ? await this.photoRepo.find({
            where: { profileId: In(profileIds) },
            order: { order: 'ASC' },
          })
        : [];
    const photoMap = new Map<string, Photo[]>();
    for (const photo of photos) {
      const list = photoMap.get(photo.profileId) || [];
      list.push(photo);
      photoMap.set(photo.profileId, list);
    }

    return {
      likes: paginatedLikes.map((l) => {
        const user = userMap.get(l.userId);
        const profile = profileMap.get(l.userId);
        const profilePhotos = profile ? photoMap.get(profile.id) || [] : [];
        return {
          ...l,
          user: user
            ? {
                id: user.id,
                fullName: user.fullName,
                photos: profilePhotos.map((p) => ({
                  id: p.id,
                  url: p.url,
                  isPrimary: p.isPrimary,
                  order: p.order,
                })),
              }
            : null,
        };
      }),
      total,
      isBlurred: false,
    };
  }

  async getMyLikes(userId: string, page = 1, limit = 20) {
    const myLikes = await this.likeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const myLikedIds = myLikes.map((l) => l.likedUserId);

    const mutualLikes = await this.likeRepo.find({
      where: myLikedIds.map((id) => ({ userId: id, likedUserId: userId })),
    });
    const mutualIds = new Set(mutualLikes.map((l) => l.userId));

    const pendingIds = myLikedIds.filter((id) => !mutualIds.has(id));
    const uniquePendingIds = [...new Set(pendingIds)];

    const paginatedIds = uniquePendingIds.slice((page - 1) * limit, page * limit);
    const total = uniquePendingIds.length;

    const users =
      paginatedIds.length > 0 ? await this.userRepo.find({ where: { id: In(paginatedIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const profiles =
      paginatedIds.length > 0
        ? await this.profileRepo.find({ where: { userId: In(paginatedIds) } })
        : [];
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const profileIds = profiles.map((p) => p.id);
    const photos =
      profileIds.length > 0
        ? await this.photoRepo.find({
            where: { profileId: In(profileIds) },
            order: { order: 'ASC' },
          })
        : [];
    const photoMap = new Map<string, Photo[]>();
    for (const photo of photos) {
      const list = photoMap.get(photo.profileId) || [];
      list.push(photo);
      photoMap.set(photo.profileId, list);
    }

    return {
      likes: paginatedIds.map((id) => {
        const user = userMap.get(id);
        const profile = profileMap.get(id);
        const profilePhotos = profile ? photoMap.get(profile.id) || [] : [];
        const likeRecord = myLikes.find((l) => l.likedUserId === id);
        return {
          user: user
            ? {
                id: user.id,
                fullName: user.fullName,
                photos: profilePhotos.map((p) => ({
                  id: p.id,
                  url: p.url,
                  isPrimary: p.isPrimary,
                  order: p.order,
                })),
              }
            : null,
          likedAt: likeRecord?.createdAt,
        };
      }),
      meta: { page, limit, total, hasMore: total > page * limit },
    };
  }

  async recordProfileView(viewerId: string, profileId: string) {
    if (viewerId === profileId) return { recorded: false };
    this.validateUserId(viewerId);
    this.validateUserId(profileId);

    const existing = await this.profileViewRepo.findOne({ where: { viewerId, profileId } });
    if (existing) return { recorded: false };

    const view = this.profileViewRepo.create({ viewerId, profileId });
    await this.profileViewRepo.save(view);

    const viewedUser = await this.userRepo.findOne({ where: { id: profileId } });
    await this.enhancementService.trackBehavior({
      userId: viewerId,
      targetUserId: profileId,
      action: 'view_profile',
      targetAge: viewedUser?.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(viewedUser.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          )
        : undefined,
      targetGender: viewedUser?.gender,
    });

    return { recorded: true };
  }

  async getProfileViewers(
    userId: string,
    page = 1,
    limit = 20,
    filter?: 'all' | 'discovery' | 'matched',
  ) {
    this.validateUserId(userId);

    const [views, total] = await this.profileViewRepo.findAndCount({
      where: { profileId: userId },
      order: { viewedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    let viewerIds = views.map((v) => v.viewerId);

    if (filter === 'discovery' || filter === 'matched') {
      const matchedUsers = await this.matchRepo.find({
        where: [{ user1Id: userId }, { user2Id: userId }],
      });
      const matchedIds = new Set<string>();
      matchedUsers.forEach((m) => {
        matchedIds.add(m.user1Id);
        matchedIds.add(m.user2Id);
      });
      matchedIds.delete(userId);

      if (filter === 'discovery') {
        viewerIds = viewerIds.filter((id) => !matchedIds.has(id));
      } else {
        viewerIds = viewerIds.filter((id) => matchedIds.has(id));
      }
    }
    const viewers =
      viewerIds.length > 0 ? await this.userRepo.find({ where: { id: In(viewerIds) } }) : [];
    const userMap = new Map(viewers.map((u) => [u.id, u]));
    const profiles =
      viewerIds.length > 0 ? await this.profileRepo.find({ where: { userId: In(viewerIds) } }) : [];
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const profileIds = profiles.map((p) => p.id);
    const photos =
      profileIds.length > 0
        ? await this.photoRepo.find({
            where: { profileId: In(profileIds) },
            order: { order: 'ASC' },
          })
        : [];
    const photoMap = new Map<string, Photo[]>();
    for (const photo of photos) {
      const list = photoMap.get(photo.profileId) || [];
      list.push(photo);
      photoMap.set(photo.profileId, list);
    }

    return {
      viewers: views.map((v) => {
        const user = userMap.get(v.viewerId);
        const profile = profileMap.get(v.viewerId);
        const viewerPhotos = profile ? photoMap.get(profile.id) || [] : [];
        return {
          id: v.id,
          userId: v.viewerId,
          viewedAt: v.viewedAt,
          user: user
            ? {
                id: user.id,
                fullName: user.fullName,
                photos: viewerPhotos.map((p) => ({
                  id: p.id,
                  url: p.url,
                  isPrimary: p.isPrimary,
                  order: p.order,
                })),
              }
            : null,
        };
      }),
      meta: { page, limit, total, hasMore: total > page * limit },
    };
  }

  async getCompatibility(userId: string, targetUserId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const target = await this.userRepo.findOne({ where: { id: targetUserId } });
    if (!user || !target) throw new NotFoundException('User not found');

    const result = await this.compatibilityEngine.score(userId, targetUserId);

    const icebreakers = await this.icebreakerGenerator.generate(
      await this.profileRepo.findOne({ where: { userId } }),
      {
        userId: target.id,
        fullName: target.fullName,
        age: target.dateOfBirth ? this.calculateAge(target.dateOfBirth) : 0,
        gender: target.gender || '',
        bio: '',
        jobTitle: '',
        city: '',
        distanceKm: 0,
        verified: false,
        completionPercentage: 0,
        photos: [],
        interests: [],
        relationshipGoal: '',
      },
      result,
    );

    return {
      compatibility: result.overallScore,
      breakdown: result.breakdown,
      sharedInterests: result.sharedInterests,
      insights: result.insights,
      icebreakers,
    };
  }

  private calculateAge(dateOfBirth: Date): number {
    const today = new Date();
    const birth = new Date(dateOfBirth);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  async getSync(userId: string, since: number) {
    return { likes: [], passes: [], matches: [] };
  }

  async createMoment(userId: string, mediaUrl: string, caption?: string, mediaType?: string) {
    this.validateUserId(userId);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentCount = await this.momentRepo.count({
      where: { userId, createdAt: MoreThan(oneHourAgo) },
    });
    if (recentCount >= 10) {
      throw new BadRequestException('Rate limit: maximum 10 moments per hour');
    }

    if (caption && caption.length > 300) {
      throw new BadRequestException('Caption must be 300 characters or less');
    }

    if (caption) {
      const toxicity = this.toxicityDetector.analyze(caption);
      if (toxicity.isToxic && toxicity.action === 'block') {
        throw new BadRequestException('Caption contains inappropriate content');
      }
    }

    if (!mediaUrl && !caption) {
      throw new BadRequestException('A moment must have either media or a caption');
    }

    const validMediaTypes = ['image', 'video'];
    if (mediaType && !validMediaTypes.includes(mediaType)) {
      throw new BadRequestException('Media type must be image or video');
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    const moment = this.momentRepo.create({
      userId,
      mediaUrl,
      caption,
      mediaType: mediaType || 'image',
      expiresAt,
    });
    return this.momentRepo.save(moment);
  }

  async getMoments(userId: string, page = 1, limit = 20) {
    const matches = await this.matchRepo.find({
      where: [
        { user1Id: userId, isActive: true },
        { user2Id: userId, isActive: true },
      ],
    });
    const matchUserIds = matches.map((m) => (m.user1Id === userId ? m.user2Id : m.user1Id));
    if (matchUserIds.length === 0)
      return { moments: [], meta: { page, limit, total: 0, totalPages: 0 } };

    const [moments, total] = await this.momentRepo.findAndCount({
      where: { userId: In(matchUserIds), expiresAt: MoreThan(new Date()), deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const momentIds = moments.map((m) => m.id);

    const views =
      momentIds.length > 0
        ? await this.momentViewRepo.find({ where: { momentId: In(momentIds), viewerId: userId } })
        : [];
    const viewedSet = new Set(views.map((v) => v.momentId));

    const userIds = [...new Set(moments.map((m) => m.userId))];
    const users =
      userIds.length > 0 ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      moments: moments.map((m) => ({
        ...m,
        viewed: viewedSet.has(m.id),
        user: userMap.get(m.userId) || null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async viewMoment(userId: string, momentId: string) {
    const moment = await this.momentRepo.findOne({ where: { id: momentId, deletedAt: IsNull() } });
    if (!moment) throw new NotFoundException('Moment not found');
    if (new Date(moment.expiresAt) <= new Date())
      throw new BadRequestException('Moment has expired');
    if (moment.userId === userId) return { viewed: true };

    const existing = await this.momentViewRepo.findOne({ where: { momentId, viewerId: userId } });
    if (!existing) {
      const view = this.momentViewRepo.create({ momentId, viewerId: userId });
      await this.momentViewRepo.save(view);
      await this.momentRepo.increment({ id: momentId }, 'viewCount', 1);

      this.createMomentViewNotification(moment.userId, momentId, userId);
    }
    return { viewed: true };
  }

  private async createMomentViewNotification(ownerId: string, momentId: string, viewerId: string) {
    try {
      const viewer = await this.userRepo.findOne({ where: { id: viewerId }, select: ['fullName'] });
      const notif = this.notifRepo.create({
        userId: ownerId,
        type: 'moment_viewed',
        title: 'Someone viewed your Moment',
        body: `${viewer?.fullName || 'Someone'} viewed your Moment`,
        data: { momentId, viewerId },
        channel: 'in_app',
      });
      await this.notifRepo.save(notif);
    } catch (e) {
      console.error('Failed to create moment view notification:', e);
    }
  }

  async deleteMoment(userId: string, momentId: string) {
    const moment = await this.momentRepo.findOne({ where: { id: momentId, deletedAt: IsNull() } });
    if (!moment) throw new NotFoundException('Moment not found');
    if (moment.userId !== userId) throw new BadRequestException('Not your moment');
    await this.momentRepo.softDelete(momentId);
    return { deleted: true };
  }

  async getMyMoments(userId: string, page = 1, limit = 20) {
    const [moments, total] = await this.momentRepo.findAndCount({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'fullName'] });
    return {
      moments: moments.map((m) => ({
        ...m,
        expired: new Date(m.expiresAt) <= new Date(),
        viewed: true,
        user: user || null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async checkScamRisk(userId: string, targetUserId: string) {
    return this.scamDetector.analyzeConversation(userId, targetUserId);
  }

  async getIcebreakers(userId: string, targetUserId: string) {
    const userProfile = await this.profileRepo.findOne({ where: { userId } });
    const targetProfile = await this.profileRepo.findOne({ where: { userId: targetUserId } });
    const targetUser = await this.userRepo.findOne({ where: { id: targetUserId } });
    if (!targetProfile || !targetUser) throw new NotFoundException('Target user not found');

    const targetInterests = await this.profileInterestRepo.find({
      where: { profileId: targetProfile.id },
      relations: ['interest'],
    });
    const interestNames = targetInterests
      .map((pi) => pi.interest?.name)
      .filter((n): n is string => !!n);

    const candidateProfile = {
      userId: targetUserId,
      fullName: targetUser.fullName,
      age: targetUser.dateOfBirth ? this.calculateAge(targetUser.dateOfBirth) : 0,
      gender: targetProfile.gender || '',
      bio: targetProfile.bio || '',
      jobTitle: targetProfile.jobTitle || '',
      city: targetProfile.city || '',
      distanceKm: 0,
      verified: targetProfile.verified,
      completionPercentage: targetProfile.completionPercentage,
      photos: [],
      interests: interestNames,
      relationshipGoal: targetProfile.relationshipGoal || '',
    };

    const compatibility = await this.compatibilityEngine.score(userId, targetUserId);
    return this.icebreakerGenerator.generate(userProfile, candidateProfile, compatibility);
  }

  async getBehavioralAnalysis(userId: string) {
    this.validateUserId(userId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const profile = await this.profileRepo.findOne({ where: { userId } });

    let riskScore = 0;
    const flags: string[] = [];

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [likesGiven24h] = await Promise.all([
      this.likeRepo.count({ where: { userId, createdAt: MoreThan(oneDayAgo) } }),
    ]);

    if (likesGiven24h > 200) {
      flags.push('mass_messaging');
      riskScore += 0.4;
    }
    if (likesGiven24h > 100) {
      flags.push('like_spam');
      riskScore += 0.3;
    }
    if (profile && !profile.bio) {
      flags.push('no_bio');
      riskScore += 0.1;
    }

    const finalRisk = Math.min(riskScore, 1);
    return {
      riskScore: Number(finalRisk.toFixed(2)),
      flags,
      isSuspicious: finalRisk > 0.5,
      safetyScore: Math.round((1 - finalRisk) * 100),
    };
  }

  async checkToxicity(text: string) {
    return this.toxicityDetector.analyze(text);
  }

  async checkFakeProfile(userId: string) {
    this.validateUserId(userId);
    return this.fakeProfileDetector.analyze(userId);
  }

  async cleanupExpiredMoments() {
    const result = await this.momentRepo.delete({ expiresAt: LessThan(new Date()) });
    return { deleted: result.affected || 0 };
  }

  async cleanupOldMoments() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = await this.momentRepo.delete({ createdAt: LessThan(thirtyDaysAgo) });
    return { deleted: result.affected || 0 };
  }
}
