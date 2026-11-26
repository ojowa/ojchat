import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { Photo, Profile, User } from '@app/common/entities';

describe('SearchService.searchUsers (privacy redaction)', () => {
  it('strips coordinates, exact DOB, employer and school from results', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            createQueryBuilder: () => ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([
                {
                  id: 'user-2',
                  fullName: 'Ada Lovelace',
                  dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
                  gender: 'female',
                },
              ]),
            }),
          },
        },
        {
          provide: getRepositoryToken(Profile),
          useValue: {
            find: jest.fn().mockResolvedValue([
              {
                id: 'profile-2',
                userId: 'user-2',
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
                gender: 'female',
                jobTitle: 'Engineer',
                company: 'Analytical Engines Ltd',
                school: 'University of London',
                latitude: 51.5073512,
                longitude: -0.1277586,
                city: 'London',
                country: 'UK',
                relationshipGoal: 'long_term',
                verified: true,
                completionPercentage: 80,
                isActive: true,
              },
            ]),
          },
        },
        { provide: getRepositoryToken(Photo), useValue: {} },
      ],
    }).compile();

    const service = moduleRef.get(SearchService);
    const result = await service.searchUsers('viewer-1', 'Ada');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('51.5073512');
    expect(serialized).not.toContain('-0.1277586');
    expect(serialized).not.toContain('1995-06-15');
    expect(serialized).not.toContain('Analytical Engines Ltd');
    expect(serialized).not.toContain('University of London');

    expect(result.users[0].age).toBeGreaterThanOrEqual(18);
    expect(result.users[0].profile).not.toHaveProperty('latitude');
    expect(result.users[0].profile).not.toHaveProperty('longitude');
    expect(result.users[0].profile).not.toHaveProperty('dateOfBirth');
    expect(result.users[0].profile).not.toHaveProperty('company');
    expect(result.users[0].profile).not.toHaveProperty('school');
  });
});
