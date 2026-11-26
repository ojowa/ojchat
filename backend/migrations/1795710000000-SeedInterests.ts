import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed the interests table with a default catalog for the profile
 * interest picker. Idempotent: conflicts on the unique name are skipped,
 * so re-running never duplicates rows.
 */
export class SeedInterests1795710000000 implements MigrationInterface {
  name = 'SeedInterests1795710000000';

  private readonly interests: Array<[string, string]> = [
    // Sports & Fitness
    ['Gym & Fitness', 'Sports & Fitness'],
    ['Running', 'Sports & Fitness'],
    ['Football', 'Sports & Fitness'],
    ['Basketball', 'Sports & Fitness'],
    ['Tennis', 'Sports & Fitness'],
    ['Swimming', 'Sports & Fitness'],
    ['Cycling', 'Sports & Fitness'],
    ['Yoga', 'Sports & Fitness'],
    ['Martial Arts', 'Sports & Fitness'],

    // Food & Drink
    ['Cooking', 'Food & Drink'],
    ['Fine Dining', 'Food & Drink'],
    ['Street Food', 'Food & Drink'],
    ['Coffee', 'Food & Drink'],
    ['Wine', 'Food & Drink'],
    ['Baking', 'Food & Drink'],
    ['Vegan Food', 'Food & Drink'],

    // Arts & Culture
    ['Movies', 'Arts & Culture'],
    ['Theatre', 'Arts & Culture'],
    ['Photography', 'Arts & Culture'],
    ['Painting', 'Arts & Culture'],
    ['Museums', 'Arts & Culture'],
    ['Reading', 'Arts & Culture'],
    ['Writing', 'Arts & Culture'],

    // Travel & Outdoors
    ['Travel', 'Travel & Outdoors'],
    ['Road Trips', 'Travel & Outdoors'],
    ['Beach', 'Travel & Outdoors'],
    ['Camping', 'Travel & Outdoors'],
    ['Hiking', 'Travel & Outdoors'],
    ['Nature', 'Travel & Outdoors'],
    ['Fishing', 'Travel & Outdoors'],

    // Music
    ['Music', 'Music'],
    ['Live Music', 'Music'],
    ['Afrobeats', 'Music'],
    ['Hip-Hop', 'Music'],
    ['R&B', 'Music'],
    ['Podcasts', 'Music'],

    // Tech & Games
    ['Technology', 'Tech & Games'],
    ['Gaming', 'Tech & Games'],
    ['Coding', 'Tech & Games'],
    ['Sci-Fi', 'Tech & Games'],
    ['Board Games', 'Tech & Games'],
    ['Chess', 'Tech & Games'],

    // Lifestyle
    ['Fashion', 'Lifestyle'],
    ['Shopping', 'Lifestyle'],
    ['Volunteering', 'Lifestyle'],
    ['Animals & Pets', 'Lifestyle'],
    ['Cars', 'Lifestyle'],
    ['Startups', 'Lifestyle'],
    ['Dance', 'Lifestyle'],
    ['Meditation', 'Lifestyle'],
    ['Self-care', 'Lifestyle'],
  ];

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, category] of this.interests) {
      await queryRunner.query(
        `INSERT INTO "interests" ("name", "category") VALUES ($1, $2)
         ON CONFLICT ("name") DO NOTHING`,
        [name, category],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const names = this.interests.map(([name]) => name);
    await queryRunner.query(`DELETE FROM "interests" WHERE "name" = ANY($1)`, [names]);
  }
}
