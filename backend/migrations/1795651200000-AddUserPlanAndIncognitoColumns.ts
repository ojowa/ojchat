import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPlanAndIncognitoColumns1795651200000 implements MigrationInterface {
  name = 'AddUserPlanAndIncognitoColumns1795651200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "incognitoMode" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" varchar NOT NULL DEFAULT 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "plan"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "incognitoMode"`);
  }
}
