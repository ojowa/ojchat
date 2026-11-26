export interface Profile {
  id: string;
  userId: string;
  firstName: string;
  lastName?: string;
  bio?: string;
  /**
   * Server-derived age in whole years. The backend never sends the exact date
   * of birth for other users, so age is the only age signal available here.
   */
  age?: number | null;
  /** Only present for the signed-in user's own profile / local cache. */
  dateOfBirth?: string;
  gender?: string;
  jobTitle?: string;
  company?: string;
  school?: string;
  city?: string;
  country?: string;
  relationshipGoal?: string;
  verified?: boolean;
  completionPercentage?: number;
  photos: Photo[];
  interests: Interest[];
  latitude?: number;
  longitude?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Minimal user projection returned with feed candidates. */
export interface FeedUser {
  id: string;
  fullName: string;
  age?: number | null;
  gender?: string | null;
}

export interface Photo {
  id: string;
  url: string;
  localPath?: string;
  order: number;
  isPrimary: boolean;
  blurHash?: string;
}

export interface Interest {
  id: string;
  name: string;
  category?: string;
}

export interface Match {
  id: string;
  user1Id: string;
  user2Id: string;
  matchedAt: string;
  matchedVia?: string;
  conversationId?: string;
  compatibilityScore?: number;
  otherUser: {
    id: string;
    fullName: string;
    avatarUrl?: string;
    photos?: Photo[];
  };
}

export interface CompatibilityBreakdown {
  interestOverlap: number;
  lifestyleCompatibility: number;
  valuesAlignment: number;
  communicationStyle: number;
  goalAlignment: number;
}

export interface CompatibilityData {
  overallScore: number;
  breakdown: CompatibilityBreakdown;
  sharedInterests: string[];
  insights: string[];
}

export interface MatchFeedItem {
  user: FeedUser;
  profile: Profile | null;
  compatibility?: CompatibilityData;
  compatibilityScore?: number;
  overallScore?: number;
  distance?: number;
}

export interface UserPreference {
  id: string;
  userId: string;
  ageMin: number;
  ageMax: number;
  maxDistance: number;
  genderPreference: string;
}
