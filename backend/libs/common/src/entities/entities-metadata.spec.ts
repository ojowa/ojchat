import { DataSource } from 'typeorm';
import { allEntities, Like, Pass, DailyLike, Block } from './index';

/**
 * Regression guard for the entity metadata.
 *
 * A malformed `@Index` decorator (for example `@Index('NAME', { unique: true })`
 * without the column list) does not fail the TypeScript compiler and the unit
 * tests mock the repositories, so nothing catches it — but TypeORM throws
 * `this.givenColumnNames is not a function` while building the metadata and
 * the backend crashes on boot.
 *
 * This test builds the real metadata exactly like the application does, so a
 * broken decorator fails here instead of in production.
 */
describe('entity metadata', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      // Never connected to — only the metadata is built.
      url: 'postgres://metadata:check@localhost:5432/metadata_check',
      entities: allEntities,
    });
    await (ds as any).buildMetadatas();
  });

  it('builds the metadata for every entity', () => {
    expect(ds.entityMetadatas.length).toBe(allEntities.length);
  });

  it.each([
    [Like, 'IDX_likes_user_liked', ['userId', 'likedUserId']],
    [Pass, 'IDX_passes_user_passed', ['userId', 'passedUserId']],
    [DailyLike, 'IDX_daily_likes_user_date', ['userId', 'date']],
    [Block, 'IDX_blocks_users', ['blockerId', 'blockedId']],
  ])('declares %s as a unique index on the right columns', (entity, name, columns) => {
    const metadata = ds.getMetadata(entity as any);
    const index = metadata.indices.find((i) => i.name === name);

    expect(index).toBeDefined();
    expect(index!.isUnique).toBe(true);
    expect(index!.columns.map((c) => c.databaseName)).toEqual(columns);
  });
});
