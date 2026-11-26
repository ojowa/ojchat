import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import {
  Appeal,
  Block,
  DailyStreak,
  Interest,
  Photo,
  Profile,
  ProfileInterest,
  ProfilePrompt,
  Report,
  User,
  UserPreference,
  UserPrompt,
  VerificationRequest,
} from '@app/common/entities';

const makeUser = () => ({
  id: 'user-2',
  fullName: 'Ada Lovelace',
  dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
  gender: 'female',
  email: 'ada@example.com',
  phone: '+15550000000',
  role: 'user',
  status: 'active',
});

const makeProfile = () => ({
  id: 'profile-2',
  userId: 'user-2',
  firstName: 'Ada',
  lastName: 'Lovelace',
  bio: 'Mathematician',
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
  prompts: [],
});

describe('UsersService.getPublicProfile (privacy redaction)', () => {
  let service: UsersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Profile), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(UserPreference), useValue: {} },
        { provide: getRepositoryToken(Block), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Report), useValue: {} },
        { provide: getRepositoryToken(Photo), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(UserPrompt), useValue: {} },
        { provide: getRepositoryToken(ProfilePrompt), useValue: {} },
        { provide: getRepositoryToken(Appeal), useValue: {} },
        { provide: getRepositoryToken(VerificationRequest), useValue: {} },
        { provide: getRepositoryToken(DailyStreak), useValue: {} },
        { provide: getRepositoryToken(Interest), useValue: {} },
        { provide: getRepositoryToken(ProfileInterest), useValue: { find: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(UsersService);

    const userRepo = moduleRef.get<any>(getRepositoryToken(User));
    const profileRepo = moduleRef.get<any>(getRepositoryToken(Profile));
    const blockRepo = moduleRef.get<any>(getRepositoryToken(Block));
    const photoRepo = moduleRef.get<any>(getRepositoryToken(Photo));
    const profileInterestRepo = moduleRef.get<any>(getRepositoryToken(ProfileInterest));

    userRepo.findOne.mockResolvedValue(makeUser());
    profileRepo.findOne.mockResolvedValue(makeProfile());
    blockRepo.findOne.mockResolvedValue(null);
    photoRepo.find.mockResolvedValue([
      { id: 'photo-1', url: 'https://cdn/x.jpg', order: 0, isPrimary: true },
    ]);
    profileInterestRepo.find.mockResolvedValue([]);
  });

  it('does not leak exact coordinates or the exact date of birth', async () => {
    const result = await service.getPublicProfile('user-2', 'viewer-1');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('51.5073512');
    expect(serialized).not.toContain('-0.1277586');
    expect(serialized).not.toContain('1995-06-15');
    expect(result.profile).not.toHaveProperty('latitude');
    expect(result.profile).not.toHaveProperty('longitude');
    expect(result.profile).not.toHaveProperty('dateOfBirth');
    expect(result).not.toHaveProperty('dateOfBirth');
  });

  it('returns age, photos and interests instead', async () => {
    const result = await service.getPublicProfile('user-2', 'viewer-1');

    expect(result.age).toBeGreaterThanOrEqual(18);
    expect(result.profile?.age).toBeGreaterThanOrEqual(18);
    expect(result.photos).toHaveLength(1);
    expect(result.profile?.photos).toHaveLength(1);
    expect(result.profile?.firstName).toBe('Ada');
  });

  it('does not leak the other user\'s contact details', async () => {
    const result = await service.getPublicProfile('user-2', 'viewer-1');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain('+15550000000');
  });
});
