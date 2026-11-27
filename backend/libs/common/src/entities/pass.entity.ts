import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('passes')
@Index('IDX_passes_user_passed', ['userId', 'passedUserId'], { unique: true })
export class Pass {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() passedUserId: string;
  @CreateDateColumn() createdAt: Date;
}
