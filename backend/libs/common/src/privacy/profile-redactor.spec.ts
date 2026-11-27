import {
  calculateAge,
  distanceBucket,
  haversineDistanceKm,
  NEVER_EXPOSE_PROFILE_FIELDS,
  redactProfile,
  redactUserSummary,
} from './profile-redactor';
import { Profile } from '../entities';

const makeProfile = (overrides: Partial<Profile> = {}): Profile =>
  ({
    id: 'profile-1',
    userId: 'user-1',
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
    verifiedAt: new Date('2025-01-01T00:00:00.000Z'),
    completionPercentage: 80,
    isActive: true,
    prompts: [{ question: 'Favourite?', answer: 'Music' }],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Profile;

describe('profile redaction (C2 — GPS / DOB leak)', () => {
  it('never exposes coordinates, exact DOB, employer or school by default', () => {
    const redacted = redactProfile(makeProfile());

    for (const field of NEVER_EXPOSE_PROFILE_FIELDS) {
      expect(redacted).not.toHaveProperty(field);
    }
    expect(JSON.stringify(redacted)).not.toContain('51.5073512');
    expect(JSON.stringify(redacted)).not.toContain('-0.1277586');
    expect(JSON.stringify(redacted)).not.toContain('1995-06-15');
  });

  it('exposes age instead of the date of birth', () => {
    const redacted = redactProfile(makeProfile());
    expect(redacted.age).toBe(calculateAge(new Date('1995-06-15T00:00:00.000Z')));
    expect(redacted.age).toBeGreaterThanOrEqual(18);
    expect(redacted).not.toHaveProperty('dateOfBirth');
  });

  it('keeps display fields the UI needs', () => {
    const redacted = redactProfile(makeProfile());
    expect(redacted.firstName).toBe('Ada');
    expect(redacted.lastName).toBe('Lovelace');
    expect(redacted.jobTitle).toBe('Engineer');
    expect(redacted.city).toBe('London');
    expect(redacted.verified).toBe(true);
    expect(redacted.prompts).toHaveLength(1);
  });

  it('only includes employment details on an explicit profile view', () => {
    const redacted = redactProfile(makeProfile(), { includeEmployment: true });
    expect(redacted.company).toBe('Analytical Engines Ltd');
    expect(redacted.school).toBe('University of London');
    expect(redacted).not.toHaveProperty('latitude');
    expect(redacted).not.toHaveProperty('longitude');
    expect(redacted).not.toHaveProperty('dateOfBirth');
  });

  it('maps photos and interests into the payload', () => {
    const redacted = redactProfile(
      makeProfile(),
      {
        photos: [
          { id: 'photo-1', url: 'https://cdn/x.jpg', order: 0, isPrimary: true } as any,
        ],
        interests: [{ id: 'i-1', name: 'Chess', category: 'Games' }],
      },
    );
    expect(redacted.photos).toEqual([
      { id: 'photo-1', url: 'https://cdn/x.jpg', order: 0, isPrimary: true },
    ]);
    expect(redacted.interests).toEqual([{ id: 'i-1', name: 'Chess', category: 'Games' }]);
  });

  it('redacts a user summary to id, name, age and gender', () => {
    const summary = redactUserSummary({
      id: 'user-1',
      fullName: 'Ada Lovelace',
      dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
      gender: 'female',
    });
    expect(Object.keys(summary).sort()).toEqual(['age', 'fullName', 'gender', 'id']);
    expect(summary).not.toHaveProperty('dateOfBirth');
  });
});

describe('calculateAge', () => {
  it('returns null for missing or invalid dates', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
    expect(calculateAge('not-a-date')).toBeNull();
  });

  it('computes whole years', () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate());
    expect(calculateAge(dob)).toBe(30);
  });
});

describe('distanceBucket', () => {
  it('buckets distances so exact location is not exposed', () => {
    expect(distanceBucket(0.4)).toBe('< 1 km');
    expect(distanceBucket(3.2)).toBe('1-5 km');
    expect(distanceBucket(7)).toBe('5-10 km');
    expect(distanceBucket(20)).toBe('10-25 km');
    expect(distanceBucket(40)).toBe('25-50 km');
    expect(distanceBucket(75)).toBe('50-100 km');
    expect(distanceBucket(150)).toBe('100-200 km');
    expect(distanceBucket(999)).toBe('200+ km');
  });

  it('returns null for unknown distance', () => {
    expect(distanceBucket(null)).toBeNull();
    expect(distanceBucket(undefined)).toBeNull();
  });
});

describe('haversineDistanceKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistanceKm(6.5244, 3.3792, 6.5244, 3.3792)).toBeCloseTo(0, 5);
  });

  it('measures a known short distance', () => {
    // ~20 km north of Lagos
    const km = haversineDistanceKm(6.5244, 3.3792, 6.7, 3.38);
    expect(km).toBeGreaterThan(15);
    expect(km).toBeLessThan(25);
  });

  it('measures a long distance', () => {
    // Lagos -> Abuja is roughly 500 km
    const km = haversineDistanceKm(6.5244, 3.3792, 9.0765, 7.3986);
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(550);
  });

  it('returns null for non-numeric input', () => {
    expect(haversineDistanceKm(NaN, 3.3792, 6.5244, 3.3792)).toBeNull();
    expect(haversineDistanceKm(6.5244, 3.3792, undefined as any, 3.3792)).toBeNull();
  });
});

describe('redactProfile distance', () => {
  it('exposes only the coarse bucket', () => {
    const profile = makeProfile();
    const redacted = redactProfile(profile, { distance: distanceBucket(20) });
    expect(redacted.distance).toBe('10-25 km');
    expect(redacted).not.toHaveProperty('latitude');
    expect(redacted).not.toHaveProperty('longitude');
  });

  it('defaults the distance to null when it is unknown', () => {
    expect(redactProfile(makeProfile()).distance).toBeNull();
  });
});
