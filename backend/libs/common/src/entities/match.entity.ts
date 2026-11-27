import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('matches')
// Pair uniqueness is enforced by a canonical (order-independent) partial
// unique index — see migrations/1795730000000-CanonicalMatchUniqueness.ts.
// A plain (user1Id, user2Id) index cannot express it: the same two users in
// the opposite order would be a different key, which is exactly how duplicate
// matches were created.
export class Match {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() user1Id: string;
  @Column() user2Id: string;
  @Column({ nullable: true }) conversationId: string;
  @CreateDateColumn() matchedAt: Date;
  @Column({ default: true }) isActive: boolean;
  @Column({ default: 'like' }) matchedVia: string;
}
