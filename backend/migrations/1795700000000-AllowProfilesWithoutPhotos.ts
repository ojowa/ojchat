import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow profiles without photos to appear in the discover feed by default.
 * Previously showProfilesWithPhotosOnly defaulted to true, which excluded
 * any user who hadn't uploaded a photo. Premium users can still opt back in
 * via Preferences -> Show profiles with photos only.
 */
export class AllowProfilesWithoutPhotos1795700000000 implements MigrationInterface {
  name = 'AllowProfilesWithoutPhotos1795700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_preferences"
      ALTER COLUMN "showProfilesWithPhotosOnly" SET DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "user_preferences" SET "showProfilesWithPhotosOnly" = false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user_preferences" SET "showProfilesWithPhotosOnly" = true
    `);
    await queryRunner.query(`
      ALTER TABLE "user_preferences"
      ALTER COLUMN "showProfilesWithPhotosOnly" SET DEFAULT true
    `);
  }
}
