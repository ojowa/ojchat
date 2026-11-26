import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * profiles."userId" was created as character varying while users.id is uuid,
 * so any SQL comparing them fails with:
 *   "operator does not exist: character varying = uuid"
 * (e.g. admin geo-analytics, candidate generator feed query).
 *
 * All existing values are valid uuids (verified before running), so a plain
 * USING cast is safe. The TypeORM entity types the field as string either way.
 */
export class FixProfilesUserIdType1795720000000 implements MigrationInterface {
  name = 'FixProfilesUserIdType1795720000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      ALTER COLUMN "userId" TYPE character varying USING "userId"::varchar
    `);
  }
}
