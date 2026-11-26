import { Photo, Profile } from '../entities';

/**
 * Fields that must NEVER be serialized into a payload that describes another
 * user.
 *
 * - `latitude` / `longitude` are `decimal(10,7)` (≈ 11 m precision). Shipping
 *   them turns the feed into a geolocation oracle: a caller can reconstruct a
 *   user's home or workplace from a single response.
 * - `dateOfBirth` is a stable, non-rotating identifier. It defeats age-gating
 *   (a client could not be trusted to enforce 18+), enables cross-database
 *   identity correlation, and is unnecessary — `age` conveys everything the
 *   UI needs.
 * - `company` / `school` are stripped from bulk/feed payloads (bulk harvesting
 *   of employment + education is a high-value profile-reconnaissance vector).
 *   They are only included on a single, deliberate profile view.
 */
export const NEVER_EXPOSE_PROFILE_FIELDS = [
  'latitude',
  'longitude',
  'dateOfBirth',
  'company',
  'school',
] as const;

/** Age in whole years from a date of birth, or `null` when unknown/invalid. */
export function calculateAge(dateOfBirth?: Date | string | null): number | null {
  if (!dateOfBirth) return null;
  const birth = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age < 0 ? null : age;
}

/**
 * Coarse distance bucket. Exact kilometre precision (~11 m) turns the feed
 * into a precise location oracle, so only a bucket is exposed to clients.
 */
export function distanceBucket(distanceKm?: number | null): string | null {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
  const km = Math.max(0, distanceKm);
  if (km < 1) return '< 1 km';
  if (km < 5) return '1-5 km';
  if (km < 10) return '5-10 km';
  if (km < 25) return '10-25 km';
  if (km < 50) return '25-50 km';
  if (km < 100) return '50-100 km';
  if (km < 200) return '100-200 km';
  return '200+ km';
}

export interface RedactedInterest {
  id: string;
  name: string;
  category?: string;
}

export interface RedactedPhoto {
  id: string;
  url: string;
  order: number;
  isPrimary: boolean;
}

export interface RedactedProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  bio: string | null;
  gender: string | null;
  jobTitle: string | null;
  city: string | null;
  country: string | null;
  relationshipGoal: string | null;
  verified: boolean;
  completionPercentage: number;
  isActive: boolean;
  /** Whole-year age derived server-side. The exact DOB is never exposed. */
  age: number | null;
  prompts: Array<{ question: string; answer: string }>;
  company?: string | null;
  school?: string | null;
  photos?: RedactedPhoto[];
  interests?: RedactedInterest[];
}

export interface RedactProfileOptions {
  photos?: Photo[];
  interests?: RedactedInterest[];
  /**
   * Include employer / school. Only enable for a single, deliberate profile
   * view — never for bulk feed payloads.
   */
  includeEmployment?: boolean;
}

/**
 * Convert a raw `Profile` entity into a client-safe payload.
 *
 * This is the single source of truth for profile serialization: any endpoint
 * that hands another user's profile to a client must go through here so a
 * newly-added sensitive column cannot silently start leaking.
 */
export function redactProfile(
  profile: Profile,
  options: RedactProfileOptions = {},
): RedactedProfile {
  const redacted: RedactedProfile = {
    id: profile.id,
    userId: profile.userId,
    firstName: profile.firstName,
    lastName: profile.lastName ?? null,
    bio: profile.bio ?? null,
    gender: profile.gender ?? null,
    jobTitle: profile.jobTitle ?? null,
    city: profile.city ?? null,
    country: profile.country ?? null,
    relationshipGoal: profile.relationshipGoal ?? null,
    verified: !!profile.verified,
    completionPercentage: profile.completionPercentage ?? 0,
    isActive: profile.isActive !== false,
    age: calculateAge(profile.dateOfBirth),
    prompts: profile.prompts ?? [],
  };

  if (options.includeEmployment) {
    redacted.company = profile.company ?? null;
    redacted.school = profile.school ?? null;
  }

  if (options.photos) {
    redacted.photos = options.photos.map((p) => ({
      id: p.id,
      url: p.url,
      order: p.order,
      isPrimary: p.isPrimary,
    }));
  }

  if (options.interests) {
    redacted.interests = options.interests;
  }

  return redacted;
}

export interface RedactedUserSummary {
  id: string;
  fullName: string;
  age: number | null;
  gender: string | null;
}

/**
 * Minimal user projection for feed-like payloads: identity, display name,
 * derived age and gender. No email, phone, role, status or DOB.
 */
export function redactUserSummary(user: {
  id: string;
  fullName: string;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
}): RedactedUserSummary {
  return {
    id: user.id,
    fullName: user.fullName,
    age: calculateAge(user.dateOfBirth),
    gender: user.gender ?? null,
  };
}
