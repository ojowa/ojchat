# OJChat Matchmaking Backend — Architecture & Security Audit

**Date:** 2026-11-26
**Scope audited:** `backend/apps/monolith` (auth gateway, matching service, AI candidate engine), `libs/common/entities`, `migrations/`, live Neon Postgres schema (verified against `information_schema`), and mobile API usage.
**Stack:** NestJS monolith + TypeORM + Neon Postgres, React Native 0.73 client, Vercel serverless entrypoint.

---

## 1. Executive Architecture Score: **3 / 10**

The codebase has good bones — clean monolith modularization, sensible unique indexes on swipe tables, helmet, throttling, request logging, event-driven side effects — but it is **not production-ready**. A single unauthenticated header-spoofing hole allows full account impersonation on every endpoint, the main feed ignores distance preferences entirely, exact GPS coordinates are shipped to clients, there is no caching layer of any kind (every swipe triggers ~10 sequential queries, every feed page 100+), and mutual-like detection is a non-transactional read-then-write race with a non-canonical unique constraint that permits both duplicate *and* missed matches. At 10k concurrent swipers the feed query alone (loading a user's entire swipe history into memory per request, `NOT IN` with thousands of parameters) will collapse the database.

---

## 2. Critical Vulnerabilities & Bottlenecks (Fix Immediately)

### 🔴 C1 — Total authentication bypass: `x-user-id` header spoofing (CVSS ~9.8)
**`gateway/middleware/auth.middleware.ts:26-31, 43-47`** + **`main.ts:60-65`**

The middleware **never rejects an unauthenticated request**:

```ts
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  if (isPublic) { return next(); }
  return next();          // ← non-public path also proceeds! dead branch
}
...
catch {
  if (!isPublic) { return next(); }  // ← invalid token also proceeds
}
```

The bridge in `main.ts` only overwrites the header **if** a token was verified:

```ts
if (req.userId) { req.headers['x-user-id'] = req.userId; }  // else client's header survives
```

**Exploit:** `GET /v1/users/me` with `x-user-id: <victim-uuid>` and **no Authorization header** → controllers (`users.controller.ts:24`, `matching.controller`, payments, `deleteMe`…) read `@Headers('x-user-id')` and act as the victim. There is no `APP_GUARD` (only `ThrottlerGuard`, `app.module.ts:86`). This enables reading anyone's data, swiping/deleting as them, and account deletion.

### 🔴 C2 — Exact GPS coordinates leaked to every client
**`matching.service.ts:274-281`** spreads the raw entity: `profile: { ...profile, photos, interests }` where `Profile` includes `latitude`/`longitude` (`profile.entity.ts:25-26`, `decimal(10,7)` ≈ 11m precision) plus exact `dateOfBirth`, `jobTitle`, `company`, `school`. The AI feed also returns `distanceKm`. Clients should receive **age + distance bucket only**.

### 🔴 C3 — Distance preference is never enforced in the live feed
**`matching.service.ts:105-214` (`getFeed`)** applies age, gender, incognito, verified, relationship-goal filters — but **no distance filter at all** (the only `ST_Distance` is passport *ordering*). The mobile app uses exactly this endpoint (`matchApi.ts:17` → `MATCHING.FEED`). `maxDistanceKm` is only honored in `candidate.generator.ts` (AI engine), which the app doesn't call. Users see and are seen by people outside their radius.

### 🔴 C4 — Mutual-like match creation is racy and non-canonical
**`matching.service.ts:377-416, 437-447, 524-560, 585-609`** + **`match.entity.ts:4`**

- Read-then-write: `findOne(mutual)` → `save(match)` with **no transaction**.
- Unique index is `(user1Id, user2Id)` **without canonical ordering** → concurrent A↔B likes can insert both `(A,B)` and `(B,A)` (duplicate match rows, duplicate conversations, double notifications), or **both miss the window → no match at all** (silent lost "It's a Match!").
- `dailyLikes` limit is check-then-increment (`:371`, `:419`) → concurrent swipes bypass plan limits; the create-if-missing path (`:360-368`) races on `UNIQUE(userId,date)` → unhandled 500.

### 🔴 C5 — Swipe endpoints don't validate the target
**`like()` / `pass()` / `superlike()` (`matching.service.ts:354, 475, 500`)** never check that the target: exists, isn't blocked in either direction, isn't deleted/banned, or would pass the feed filters. A crafted request likes arbitrary user IDs (including users who blocked you), creating orphan rows and notification spam — paywall/visibility bypass by direct API call.

### 🟠 B1 — Feed loads unbounded tables into memory per request
**`matching.service.ts:110-118`**: `likeRepo.find({where:{userId}})` + passes + blocks — **no `take`** — then `u.id NOT IN (:...excludeIds)` with potentially thousands of bind parameters. A user with 5k swipes → 5k-parameter query, full array materialization, **on every feed page and every refresh**.

### 🟠 B2 — `IN (:...allIds)` full-table loads
- `:145-154` — loads **every verified profile's userId** into memory to filter one user.
- `:156-167` — same for relationship goals.
- `:170-183` — loads **every userId that has any photo**.

### 🟠 B3 — N+1 scoring: 100+ queries per feed page
**`matching.service.ts:284-298`**: `Promise.all(candidates.map(c => compatibilityEngine.score(...)))` — each score runs ≥5 queries (`compatibility.engine.ts:39-57,204`: 2 profile finds, prefs, interests, prompts…). 20 candidates ≈ **100+ queries per page**, plus plan lookups, boost lookups, and behavior tracking per swipe (~10 sequential queries/like at `:356-471`).

### 🟠 B4 — No caching layer whatsoever
Zero Redis/cache usage anywhere in `apps/` (`config.redis` exists but is unused). No deck pre-computation; every swipe and page pull hits Postgres with the heavy query above.

### 🟠 B5 — Missing indexes
- `blocks(blockedId)` — `blockedMe` query (`matching.service.ts:115`) has no usable index (`IDX_blocks_users` leads with `blockerId`).
- No composite feed index: `users(status, gender, dateOfBirth)` / partial `WHERE status='active' AND incognitoMode=false`.
- `profiles(userId, verified)`, `profiles(relationshipGoal)` for the `IN` filters.
- **No spatial index** (no PostGIS at all — `lat/lon` are `decimal`, Haversine runs in JS over loaded rows: `candidate.generator.ts:100-134`). Note: passport ordering uses `ST_SetSRID/ST_MakePoint/::geography` (`matching.service.ts:188-193`) — **PostGIS functions that will 500 if the extension isn't installed** (no migration creates it).

### 🟡 S1 — Side effects inline with the HTTP response
`eventEmitter.emit('notification.send'|'match.created')` (`:401, 450, 465`) uses sync EventEmitter2; `@OnEvent` handlers (push notification network I/O, conversation creation, Elo writes `await updateEloOnMatch` ×2) run inside the swipe request. No queue, no retry, no outbox — a slow Expo push call delays every swipe.

### 🟡 S2 — ValidationPipe is decorative
`main.ts:33-40` sets `whitelist/forbidNonWhitelisted`, but controllers accept `@Body() body: any` — no DTO classes → **zero input validation** on most mutating endpoints (mass assignment: e.g. `updateMe`/`updatePreferences` accept arbitrary keys).

### 🟡 S3 — Cold start / starvation
No newbie visibility boost in `getFeed` (boosts only reorder), no radius-expansion fallback, no re-circulation of passed users, no "deck empty" strategy — new users in sparse areas permanently see "No more profiles". Swagger `/docs` is public (information disclosure, low).

---

## 3. Database vs. Backend Boundary Review

| Currently in the **DB** that belongs in the **Backend** | Currently in the **Backend** that belongs in the **DB** |
|---|---|
| Nothing improper — DB is underused, not overused | **Haversine distance in JS** (`candidate.generator.ts:100-134`) → should be `ST_DWithin` on `geography` with a GIST index |
| | **Age/gender hard filters split across JS date-string math** (`matching.service.ts:123-125`) → should be a parameterized SQL range on an indexed column |
| | **Exclusion sets materialized in Node** (`:110-118`) → should be `NOT EXISTS` anti-joins executed by the planner |
| | **Verification/goal/photo "filters" as giant `IN(list)`** → should be SQL `EXISTS` subqueries or joins |
| | **Compatibility scoring N+1 in request path** → belongs in backend service **precomputed asynchronously** (batch/worker), served from cache |
| | **Mutual-like detection via app-level read-then-write** → belongs in DB as canonical `UNIQUE` constraint + atomic upsert |
| | **Daily like counters via check-then-increment** → belongs in DB as `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit RETURNING` |
| | **Deck/ranking state** → belongs in backend cache (Redis), invalidated by DB events |

**Correct division to aim for:** DB = storage, hard filters (age/gender/distance/blocked/swiped via indexed SQL), uniqueness constraints, atomic counters. Backend = scoring/ranking, deck caching, side-effect orchestration, privacy redaction.

---

## 4. Refactored Code & Schema Fixes

### 4.1 — Kill the auth bypass (do first; ~10 lines)

```ts
// gateway/middleware/auth.middleware.ts
use(req: Request, _res: Response, next: NextFunction) {
  const url = (req as any).originalUrl || req.url;
  const isPublic = this.publicPaths.some((p) => url.startsWith(p));

  // Never trust a client-supplied identity header — strip it unconditionally.
  delete req.headers['x-user-id'];

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    if (isPublic) return next();
    return next(new UnauthorizedException('Authentication required'));
  }
  try {
    const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
    if (payload?.sub) (req as any).userId = payload.sub;
    return next();
  } catch {
    if (isPublic) return next();
    return next(new UnauthorizedException('Invalid or expired token'));
  }
}
```
Plus a belt-and-braces `APP_GUARD` (`JwtAuthGuard` reading `req.userId`) so new routes are secure by default, and delete the client's header in `main.ts` before the bridge (`delete req.headers['x-user-id']; if (req.userId) ...`).

### 4.2 — Atomic, canonical match creation

```sql
-- Migration: canonical match uniqueness (safe for concurrent A<->B swipes)
CREATE UNIQUE INDEX "IDX_matches_canonical"
  ON "matches" (LEAST("user1Id","user2Id"), GREATEST("user1Id","user2Id"))
  WHERE "isActive" = true;
```
```ts
// matching.service.ts — replace all four match-creation blocks
const [a, b] = [likerId, likedId].sort();           // canonical order
const match = await this.matchRepo
  .createQueryBuilder()
  .insert()
  .into(Match)
  .values({ user1Id: a, user2Id: b, isActive: true, matchedAt: () => 'NOW()' })
  .orIgnore()                                        // ON CONFLICT DO NOTHING
  .returning(['id', 'conversationId'])
  .execute();

if (!match.raw[0]) return { liked: true, matched: false }; // other side already created it
// emit match.created + Elo updates ONLY when raw[0] exists
```
Wrap the mutual-like check + like insert in `dataSource.transaction()` so A and B can't both observe a half-state.

### 4.3 — Atomic daily limits (race-proof paywall)

```ts
const res = await this.dailyLikeRepo.query(
  `INSERT INTO daily_likes ("userId", date, "likesGiven", "superLikesGiven")
   VALUES ($1, CURRENT_DATE, 0, 0)
   ON CONFLICT ("userId", date) DO UPDATE
     SET "likesGiven" = daily_likes."likesGiven" + 1
   WHERE daily_likes."likesGiven" < $2
   RETURNING *`, [likerId, planInfo.dailyLikesLimit]);
if (!res[0]) throw new BadRequestException('Daily like limit reached');
```

### 4.4 — PostGIS + hard distance filtering (DB does filtering)

```sql
-- Migration
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location geography(Point, 4326);
UPDATE profiles SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
 WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS IDX_profiles_location_gist ON profiles USING GIST (location);
-- supporting feed indexes
CREATE INDEX IF NOT EXISTS IDX_users_feed ON users (status, gender, "dateOfBirth")
  WHERE status = 'active' AND "incognitoMode" = false;
CREATE INDEX IF NOT EXISTS IDX_blocks_blocked ON blocks ("blockedId");
CREATE INDEX IF NOT EXISTS IDX_profiles_user_verified ON profiles ("userId") WHERE verified = true;
```
```sql
-- Distance becomes an indexed pre-filter (ST_DWithin uses the GIST index)
AND ST_DWithin(p.location, $myLocation, $maxDistanceKm * 1000)
```
Haversine stays only as a cheap tie-breaker for *sorting*, computed on the already-filtered page.

### 4.5 — Feed exclusions as anti-joins (no more in-memory ID arrays)

```sql
-- replaces: u.id NOT IN (:...excludeIds) fed by 4 full-table loads
AND NOT EXISTS (SELECT 1 FROM likes  l WHERE l."userId" = :me AND l."likedUserId" = u.id)
AND NOT EXISTS (SELECT 1 FROM passes p WHERE p."userId" = :me AND p."passedUserId" = u.id)
AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b."blockerId" = :me AND b."blockedId" = u.id)
                                    OR    (b."blockedId" = :me AND b."blockerId" = u.id))
```
And move the verified/goal/photo `IN(...)` lists into `EXISTS` subqueries against `profiles`.

### 4.6 — Two-way hard filtering (candidate's prefs apply too)

```sql
-- candidate must also satisfy the *viewer's* profile gender/age prefs
AND EXISTS (
  SELECT 1 FROM user_preferences cp
  WHERE cp."userId" = u.id
    AND (cp."showMe" = 'everyone' OR cp."showMe" = :myGender)
    AND EXTRACT(YEAR FROM AGE(u."dateOfBirth")) BETWEEN cp."ageMin" AND cp."ageMax"
)
```
(Reverse direction is already enforced for the *requester*; this closes the "I see people who don't want to see me" leak.)

### 4.7 — Privacy redaction (backend owns serialization)

```ts
private redact(p: Profile & { photos?: any[]; interests?: any[] }) {
  const { latitude: _lat, longitude: _lon, ...rest } = p;
  return { ...rest, age: this.ageFrom(p.dateOfBirth), dateOfBirth: undefined,
           distanceKm: this.distanceMeters(p.location, myLoc) / 1000 };
}
```
Never return `latitude`, `longitude`, exact DOB, `company`, or `school` in feed payloads.

### 4.8 — Deck caching (Redis) + stale-queue handling

```ts
// key: deck:{userId} — sorted set of candidateIds scored at refill time
async getDeckPage(userId: string, page: number) {
  const start = page * PAGE, stop = start + PAGE - 1;
  let ids = await redis.zrange(`deck:${userId}`, start, stop);
  if (ids.length < PAGE) { await this.refillDeck(userId); ids = await redis.zrange(...); }
  // stale-queue guard: re-validate visibility before serving
  const visible = await this.filterVisible(userId, ids);   // blocks/deactivated/deleted via NOT EXISTS
  return this.loadAndRedact(visible);
}
async onBlockOrDelete(a: string, b: string) {
  await redis.zrem(`deck:${a}`, b); await redis.zrem(`deck:${b}`, a); // invalidate both directions
}
```
Refill runs **off the request path** (cron/after-swipe async), applying the SQL of 4.4–4.6 and scoring once. Cold start: new users get a `newbie` score boost + radius fallback (radius → 1.5× → country) until the deck empties, then a "expand search" state instead of a dead end.

### 4.9 — Decouple side effects
Make `@OnEvent` handlers run via an outbox/queue (BullMQ + Redis, or at minimum `@AsyncEventEmitter`): push notifications, Elo updates, deck refill, analytics. The swipe transaction commits → HTTP 200 in <50ms; workers do the rest with retry.

---

## 5. Step-by-Step Remediation Plan

| # | Status | Priority | Action | Effort |
|---|---|---|---|---|
| 1 | ✅ **DONE** (`e5b482e`) | 🔴 **P0 — today** | Fix auth middleware: reject unauthenticated non-public routes + strip client `x-user-id` (§4.1). Add `APP_GUARD`. | <1h |
| 2 | ✅ **DONE** (`63b3e45`) | 🔴 **P0 — today** | Stop leaking `latitude`/`longitude`/exact DOB in `getFeed` + AI feed (§4.7) | 1h |
| 3 | ✅ **DONE** | 🔴 **P0 — this week** | Add block/existence/target-visibility checks to `like/pass/superlike` (C5) | 2h |
| 4 | ✅ **DONE** | 🔴 **P0 — this week** | Canonical match upsert + partial unique index + transaction (§4.2); atomic daily counters (§4.3) | 3h |
| 5 | ⬜ TODO | 🟠 **P1** | PostGIS migration + `ST_DWithin` distance filter in `getFeed` — fixes C3 + B5 together (§4.4). Verify/enable `postgis` extension first (passport query already assumes it) | 4h |
| 6 | ⬜ TODO | 🟠 **P1** | Replace in-memory exclusion arrays & `IN(allIds)` with `NOT EXISTS`/`EXISTS` anti-joins (§4.5); add missing indexes | 4h |
| 7 | ⬜ TODO | 🟠 **P1** | Redis deck cache with stale-queue invalidation on block/delete/match (§4.8) | 2–3d |
| 8 | ⬜ TODO | 🟡 **P2** | Move compatibility scoring + Elo off the request path; async side effects via queue (§4.9) | 2d |
| 9 | ⬜ TODO | 🟡 **P2** | Two-way preference filtering (§4.6); DTO validation on all mutating endpoints (S2) | 2d |
| 10 | ⬜ TODO | 🟡 **P3** | Cold-start newbie boost + radius fallback; throttle/lock Swagger `/docs` in production | 2d |

### Remediation log

**Fix #1 — Auth bypass (C1)** · commit `e5b482e`
- `gateway/middleware/auth.middleware.ts` rewritten: client `x-user-id` is **always** stripped; requests without a valid token are rejected on every non-public path; admin tokens (`ADMIN_JWT_SECRET`) pass through with an `isAdminToken` flag because the admin controller self-authenticates per route.
- New `gateway/guards/jwt-auth.guard.ts` registered as `APP_GUARD` (defense in depth — no `/v1` route can execute without a verified identity).
- `main.ts` bridge now strips the header before conditionally re-setting it from the verified token.
- 12 new regression tests (`auth.middleware.spec.ts`).

**Fix #2 — Privacy redaction (C2)** · commit `e5b482e`+1
- New single source of truth for profile serialization: `libs/common/src/privacy/profile-redactor.ts` (`redactProfile`, `redactUserSummary`, `calculateAge`, `distanceBucket`).
- `getFeed` no longer spreads the raw `Profile` entity — it now emits a redacted profile (no `latitude`, `longitude`, exact `dateOfBirth`, `company`, `school`) plus a server-derived `age`.
- `GET /users/:id` (public profile) is redacted the same way (exact GPS + DOB removed; `age` added; employment kept for this single deliberate view), and now returns the profile's interests.
- `GET /search/users` (bulk listing) is redacted with the strict policy (employment stripped).
- Mobile updated: `SwipeableCard` and `UserProfileScreen` read the server-derived `age`; `types/match.ts` gained `age` and a `FeedUser` projection.
- Test infra fix: Jest could not resolve `@app/common/*` (module `moduleNameMapper` does not support regex capture groups) — replaced with `jest.resolver.js` mirroring the tsconfig path aliases.
- 14 new tests (`profile-redactor.spec.ts`, `users.service.spec.ts`, `search.service.spec.ts`).

**Fix #3 — Swipe target validation (C5)**
- New `MatchingService.validateSwipeTarget(actorId, targetId)` runs before any like/pass/super-like row is written. It enforces:
  - the target id is a valid UUID (otherwise a malformed id reached the driver and produced a 500),
  - the caller and the target both exist,
  - neither party is `suspended` / `banned` / `deactivated` (`pending_verification` is deliberately allowed — registration creates accounts in that state and only the email OTP promotes them to `active`),
  - **no block in either direction** — you can no longer like/pass someone who blocked you,
  - the target actually has an active profile to swipe on.
- Discovery preferences (age/gender/verified-only/…) are intentionally **not** enforced here: they are discovery filters, not access control, and enforcing them would break the legitimate "search a person → open their profile → like them" flow. Two-way preference filtering stays in item #9.
- `like()` / `superlike()` were reordered so the idempotency check runs **before** the quota check: re-liking somebody already liked no longer consumes quota and no longer fails with "limit reached" when the user is already at their limit (the app retries likes after a flaky connection). The limit message also showed `limit/limit` before — it now shows the real count.
- Mobile: swipe failures are surfaced (`Alert` with the server message) and the card is restored instead of staying stuck off-screen; `SwipeableCard` now resets its drag transform when the profile changes, so the next card is actually visible after a drag-swipe.
- 18 new tests (`matching.service.spec.ts`).

**Fix #4 — Canonical match upsert + atomic daily counters (C4)**

*The live database was inspected first, and the problem turned out to be worse than reported:* the `public` schema had **no unique index at all** on `matches(user1Id,user2Id)`, `likes(userId,likedUserId)`, `passes(userId,passedUserId)` or `daily_likes(userId,date)` — only the primary keys. (A legacy `matching` schema with snake_case columns still exists in the same database but is not used by the monolith.) So duplicate matches, duplicate likes and split daily-counter rows were all possible, and the quota check read one counter row while the increment hit another.

- **Migration `1795730000000-CanonicalMatchUniqueness`** (applied to the live DB):
  - normalises every match row to canonical order (`user1Id < user2Id`), removes self-matches and duplicate rows (keeping an active row over an inactive one, then the oldest),
  - deduplicates likes/passes and **merges** duplicate daily-counter rows by summing them (no quota is lost),
  - creates the unique indexes the service depends on: `IDX_matches_canonical` (unique on `LEAST(user1Id,user2Id), GREATEST(user1Id,user2Id)` where `isActive`, so an unmatch can still be followed by a fresh match), `IDX_likes_user_liked`, `IDX_passes_user_passed`, `IDX_daily_likes_user_date`, `IDX_blocks_users`.
  - Verified on the live DB: a duplicate like, a duplicate match in the *same* order and a duplicate match in the *reversed* order are all rejected.
- **Service** — `like()` / `superlike()` now run in a single transaction that:
  1. **locks both participant rows** (`SELECT … ORDER BY id FOR UPDATE`) so two users swiping each other at the same instant are serialised. Without it both sides can observe a half-state and *silently lose* the match — the audit's worst outcome. The deterministic lock order prevents deadlocks;
  2. reserves the daily quota with a **single conditional upsert** (`INSERT … ON CONFLICT DO UPDATE … WHERE counter + delta <= limit`) — the old read-then-increment let concurrent swipes exceed the plan limit, and the create-if-missing path raced into a 500;
  3. inserts the like idempotently (`ON CONFLICT DO NOTHING`);
  4. creates the match with one atomic statement (`INSERT … SELECT … WHERE both likes exist … ON CONFLICT DO NOTHING RETURNING`) — it can only ever create one match row, and `match.created` is emitted only by the side that actually created it, so the conversation and the notifications are created exactly once.
- `undo()` / `rewind()` give quota back with `GREATEST(0, counter - 1)` so a counter can never go negative.
- `pass()` inserts idempotently as well.
- **Verified against the live database with real concurrent transactions:**
  - simultaneous mutual likes A↔B → **exactly one** match row (never 0, never 2),
  - 10 concurrent likes against 10 different targets with a limit of 5 → **exactly 5** likes recorded and 5 refused, one counter row,
  - 10 concurrent identical likes → **one** like row.
- 24 tests in `matching.service.spec.ts` (validation + transactional behaviour).

**Bottom line:** fix #1 before anything else — as it stands, any anonymous caller can act as any user. Then privacy redaction (#2), then the match/limit races (#4), then the geospatial + query rework (#5–6) before scaling past a few thousand users. The scoring/caching layers (#7–8) are what turn this from "correct" into "fast at 10k concurrent swipers."
