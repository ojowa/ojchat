import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix #5 — PostGIS + hard distance filtering (audit C3 + B5).
 *
 * Findings on the live database:
 *  - The `postgis` extension was NOT installed (it is available: 3.5.7), so
 *    every PostGIS function call failed with `type "geography" does not exist`.
 *    The feed's passport ordering already called `ST_SetSRID`/`ST_MakePoint`
 *    → a live 500 for every user with passport mode enabled.
 *  - `users` has no `latitude`/`longitude` columns at all — location lives on
 *    `profiles`. The passport ordering referenced `u.longitude`/`u.latitude`,
 *    which is a second, independent error (`column u.longitude does not exist`).
 *  - There was no spatial index, so the distance preference could not be
 *    enforced efficiently even if it had been enforced at all.
 *
 * This migration:
 *  1. installs PostGIS,
 *  2. adds `profiles.location geography(Point, 4326)` and backfills it from
 *     the existing latitude/longitude columns,
 *  3. keeps `location` in sync with a BEFORE INSERT/UPDATE trigger, so a user
 *     who moves is re-indexed automatically instead of silently going stale,
 *  4. adds the GIST spatial index used by `ST_DWithin`,
 *  5. adds the supporting feed indexes (partial feed index on users, the
 *     reverse-direction blocks index, and the profiles/photos indexes the
 *     feed filters rely on).
 */
export class PostGISLocationAndFeedIndexes1795740000000 implements MigrationInterface {
  name = 'PostGISLocationAndFeedIndexes1795740000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. PostGIS.
    //    Installed explicitly into `public` so the unqualified `geography`
    //    type and the ST_* functions resolve with the app's search_path
    //    ("$user", public) — PostGIS' default schema is not in it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public`);

    // 2. The geography column.
    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD COLUMN IF NOT EXISTS "location" geography(Point, 4326)
    `);

    // 3. Keep location in sync with latitude/longitude.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "profiles_sync_location"() RETURNS trigger AS $$
      BEGIN
        IF (TG_OP = 'INSERT')
           OR NEW."latitude" IS DISTINCT FROM OLD."latitude"
           OR NEW."longitude" IS DISTINCT FROM OLD."longitude" THEN
          IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
            NEW."location" := NULL;
          ELSE
            NEW."location" := ST_SetSRID(
              ST_MakePoint(NEW."longitude", NEW."latitude"), 4326
            )::geography;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_profiles_sync_location" ON "profiles"
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_profiles_sync_location"
      BEFORE INSERT OR UPDATE ON "profiles"
      FOR EACH ROW EXECUTE FUNCTION "profiles_sync_location"()
    `);

    // 4. Backfill the existing rows (the trigger also covers them, but an
    //    explicit statement keeps the migration independent of trigger order).
    await queryRunner.query(`
      UPDATE "profiles"
      SET "location" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
      WHERE "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
        AND "location" IS NULL
    `);

    // 5. Spatial index — this is what makes ST_DWithin an indexed pre-filter
    //    instead of a full table scan.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_profiles_location_gist"
      ON "profiles" USING GIST ("location")
    `);

    // 6. Supporting feed indexes.
    //    Partial index over the exact rows the feed scans.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_feed"
      ON "users" ("status", "gender", "dateOfBirth")
      WHERE "status" = 'active' AND "incognitoMode" = false
    `);

    //    The reverse-direction blocks lookup (blockedMe) has no usable index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_blocks_blocked"
      ON "blocks" ("blockedId")
    `);

    //    Verified / relationship-goal filters.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_profiles_verified"
      ON "profiles" ("userId") WHERE "verified" = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_profiles_relationship_goal"
      ON "profiles" ("relationshipGoal") WHERE "relationshipGoal" IS NOT NULL
    `);

    //    The "profiles with photos only" filter joins photos by profileId.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_photos_profile"
      ON "photos" ("profileId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_photos_profile"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_relationship_goal"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_verified"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blocks_blocked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_feed"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_location_gist"`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_profiles_sync_location" ON "profiles"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "profiles_sync_location"()`);

    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "location"`);

    // The PostGIS extension is intentionally left in place: other objects may
    // depend on it, and dropping an extension is not safely reversible here.
  }
}
