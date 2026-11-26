import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User, Profile, Photo } from '@app/common/entities';
import { redactProfile, redactUserSummary } from '@app/common/privacy';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Profile) private profileRepo: Repository<Profile>,
    @InjectRepository(Photo) private photoRepo: Repository<Photo>,
  ) {}

  async searchUsers(userId: string, query: string, page = 1, limit = 20) {
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.fullName ILIKE :query', { query: `%${query}%` })
      .andWhere('u.id != :userId', { userId })
      .andWhere('u.status = :status', { status: 'active' })
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const userIds = users.map((u) => u.id);
    const profiles =
      userIds.length > 0 ? await this.profileRepo.find({ where: { userId: In(userIds) } }) : [];
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    return {
      users: users.map((u) => ({
        // Privacy (C2): search is a bulk listing — strip exact coordinates,
        // exact DOB, employer and school from the profile it returns.
        ...redactUserSummary(u),
        profile: profileMap.has(u.id) ? redactProfile(profileMap.get(u.id)!) : null,
      })),
      meta: { page, limit, hasMore: users.length === limit },
    };
  }

  async autocomplete(userId: string, query: string) {
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.fullName ILIKE :query', { query: `%${query}%` })
      .andWhere('u.id != :userId', { userId })
      .take(10)
      .getMany();
    return { suggestions: users.map((u) => ({ id: u.id, fullName: u.fullName })) };
  }
}
