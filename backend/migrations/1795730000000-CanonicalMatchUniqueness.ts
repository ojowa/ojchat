import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes the uniqueness constraints that the matching logic depends on.
 *
 * Findings on the live database:
 *  - `matches` only had its primary key — no uniqueness on the user pair, so
 *    concurrent A<->B swipes could insert BOTH `(A,B)` and `(B,A)` (duplicate
 *    matches, duplicate conversations, duplicate notifications).
 *  - `likes`, `passes` and `daily_likes` also had no unique indexes, so the
 *    same user could like the same person twice and a user could end up with
 *    several counter rows for one day (which silently defeats the plan limits:
 *    the quota check reads one row while the increment hits another).
 *
 * This migration:
 *  1. normalises every match row to canonical order (user1Id < user2Id),
 *  2. removes self-matches and duplicate rows (keeping the oldest / an active
 *     one), merging duplicate daily counters by summing them,
 *  3. creates the unique indexes the service now relies on:
 *       matches:      unique on (LEAST(user1Id,user2Id), GREATEST(user1Id,user2Id))
 *                     WHERE "isActive" = true   (partial, so an unmatch can be
 *                     followed by a fresh match)
 *       likes:        unique on (userId, likedUserId)
 *       passes:       unique on (userId, passedUserId)
 *       daily_likes:  unique on (userId, date)   (required for the atomic
 *                     ON CONFLICT quota upsert)
 *       blocks:       unique on (blockerId, blockedId)
 */
export class CanonicalMatchUniqueness1795730000000 implements MigrationInterface {
  name = 'CanonicalMatchUniqueness1795730000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Canonical order: user1Id is always the lexicographically smaller id.
    await queryRunner.query(`
      UPDATE "matches"
      SET "user1Id" = LEAST("user1Id", "user2Id"),
          "user2Id" = GREATEST("user1Id", "user2Id")
      WHERE "user1Id" > "user2Id"
    `);

    // 2. A user can never be matched with themselves.
    await queryRunner.query(`DELETE FROM "matches" WHERE "user1Id" = "user2Id"`);

    // 3. One row per canonical pair: keep an active row over an inactive one,
    //    otherwise keep the oldest (id breaks ties deterministically).
    await queryRunner.query(`
      DELETE FROM "matches" m
      USING "matches" keep
      WHERE LEAST(m."user1Id", m."user2Id") = LEAST(keep."user1Id", keep."user2Id")
        AND GREATEST(m."user1Id", m."user2Id") = GREATEST(keep."user1Id", keep."user2Id")
        AND (
          (keep."isActive" AND NOT m."isActive")
          OR (
            keep."isActive" = m."isActive"
            AND (
              m."matchedAt" > keep."matchedAt"
              OR (m."matchedAt" = keep."matchedAt" AND m."id" > keep."id")
            )
          )
        )
    `);

    // 4. Duplicate likes / passes: keep the oldest row.
    await queryRunner.query(`
      DELETE FROM "likes" l
      USING "likes" keep
      WHERE l."userId" = keep."userId"
        AND l."likedUserId" = keep."likedUserId"
        AND (
          l."createdAt" > keep."createdAt"
          OR (l."createdAt" = keep."createdAt" AND l."id" > keep."id")
        )
    `);

    await queryRunner.query(`
      DELETE FROM "passes" p
      USING "passes" keep
      WHERE p."userId" = keep."userId"
        AND p."passedUserId" = keep."passedUserId"
        AND (
          p."createdAt" > keep."createdAt"
          OR (p."createdAt" = keep."createdAt" AND p."id" > keep."id")
        )
    `);

    // 5. Duplicate daily counters: merge them into the oldest row so no quota
    //    is lost, then drop the leftovers.
    //    NOTE: Postgres has no MIN(uuid) aggregate — the id is compared as
    //    text (uuid text order is the same as uuid byte order).
    await queryRunner.query(`
      WITH merged AS (
        SELECT "userId",
               date,
               MIN("id"::text)::uuid AS keep_id,
               SUM("likesGiven")::int AS likes,
               SUM("superLikesGiven")::int AS super_likes
        FROM "daily_likes"
        GROUP BY "userId", date
        HAVING COUNT(*) > 1
      )
      UPDATE "daily_likes" d
      SET "likesGiven" = merged.likes,
          "superLikesGiven" = merged.super_likes
      FROM merged
      WHERE d."id" = merged.keep_id
    `);

    await queryRunner.query(`
      DELETE FROM "daily_likes" d
      USING "daily_likes" keep
      WHERE d."userId" = keep."userId"
        AND d.date = keep.date
        AND d."id" > keep."id"
    `);

    // 6. The uniqueness the matching service relies on.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_matches_users"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_matches_canonical"
      ON "matches" (LEAST("user1Id", "user2Id"), GREATEST("user1Id", "user2Id"))
      WHERE "isActive" = true
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_likes_user_liked"
      ON "likes" ("userId", "likedUserId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_passes_user_passed"
      ON "passes" ("userId", "passedUserId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_daily_likes_user_date"
      ON "daily_likes" ("userId", date)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blocks_users"
      ON "blocks" ("blockerId", "blockedId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_matches_canonical"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_likes_user_liked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_passes_user_passed"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_daily_likes_user_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blocks_users"`);

    // Restore the previous (non-canonical) uniqueness on the match pair.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_matches_users"
      ON "matches" ("user1Id", "user2Id")
    `);
  }
}
