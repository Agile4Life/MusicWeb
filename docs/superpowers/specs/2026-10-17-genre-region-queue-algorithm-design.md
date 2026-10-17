# Genre & Region-Aware Queue Recommendation Algorithm — Design Spec

**Date:** 2026-10-17  
**Status:** Draft for User Review  
**Scope:** Multi-signal track classification (`region` + `genre`), strict region/genre filtering and style-first scoring in Auto-Queue (`buildNextQueue` & `getSmartRecommendedTracks`), and context-aware queue transitions in `queueController`, `TrackList`, and `HomePage`.

---

## 1. Problem Statement

Currently, tracks in the playback queue jump erratically across unrelated genres and countries, failing to match either the currently playing track or the listener's taste within that style:

1. **Source-Biased Scoring in [`lib/queueRecommend.ts`](file:///d:/MusicWeb/lib/queueRecommend.ts)**:
   - `buildNextQueue()` assigns fixed high base scores + source bonuses to NhacCuaTui (`1.4 + 0.4 = 1.80`) and SoundCloud (`1.35 + 0.35 = 1.70`) keyword search results, outscoring Deezer Artist Radio (`1.10`) and Related Artists (`0.90`).
   - After `diversify()` limits the seed artist to 2 tracks, the remaining 10 slots are filled with loose keyword matches from NCT/SoundCloud or unfiltered user history regardless of genre or country.
2. **Missing Genre & Region Filtering on Candidates**:
   - `buildNextQueue()` analyzes `seedTrack` only to whitelist negative keywords (`GENRE_ALLOWED_KEYWORDS`), never classifying or filtering candidate tracks by region or genre compatibility.
   - `getInternalCollaborativeCandidates()` falls back to the user's last 20 completed `listen_events` without checking if those historical tracks match the current track's region or genre.
3. **Weak Metadata Classifier in [`lib/smartRecommend.ts`](file:///d:/MusicWeb/lib/smartRecommend.ts)**:
   - Missing `cn` (C-Pop / Chinese) region support.
   - Small hardcoded artist arrays (~11–35 artists per region).
   - Line 73 (`if (/^[a-z0-9\s.,'?!()-]+$/i.test(text)) region = 'us'`) misclassifies any Vietnamese or Asian song with an English or unaccented title (e.g., *MONO - Waiting For You*, *HIEUTHUHAI - Exit Sign*, *ILLIT - Magnetic*) as `'us'`.
   - Genre detection relies only on literal title keywords (`ballad`, `rap`, `indie`, `remix`), defaulting almost all tracks to `'pop'` because most song titles do not contain their genre name.
4. **Unfiltered Queue Transitions in [`lib/playback/queueController.ts`](file:///d:/MusicWeb/lib/playback/queueController.ts) & UI Lists**:
   - `prepareSearchTrack()` splices a newly searched track into the middle of the existing queue without pruning incompatible trailing tracks, so playback jumps back to the old queue's unrelated style after the searched track ends.
   - Clicking a track in mixed lists (Home Trending, Recently Played, Google Drive, All Tracks) loads the entire mixed list into `queue`, and Shuffle (`selectNext`) picks uniformly at random across incompatible genres and regions.

---

## 2. Architecture & Component Design

### 2.1. Multi-Signal Track Classifier (`lib/trackClassifier.ts`)

Create [`lib/trackClassifier.ts`](file:///d:/MusicWeb/lib/trackClassifier.ts) (and re-export compatible helpers from [`lib/smartRecommend.ts`](file:///d:/MusicWeb/lib/smartRecommend.ts)):

```ts
export type TrackRegion = 'vn' | 'kr' | 'jp' | 'cn' | 'us' | 'global'
export type TrackGenre = 'ballad' | 'indie' | 'rnb' | 'rap' | 'pop' | 'remix'

export interface TrackStyleProfile {
  region: TrackRegion
  regionConfidence: 'high' | 'medium' | 'low'
  genre: TrackGenre
  subGenres: TrackGenre[]
  artistCanonical: string
  relatedArtists: string[]
  queryTerms: string[]
}
```

#### Region Detection Pipeline (Priority Order)
1. **Curated Artist Knowledge Graph (`ARTIST_PROFILES`)**:
   - Normalizes and splits multi-artist strings (handling `,`, `&`, `ft.`, `feat.`, `x`, `-`).
   - Maps 200+ popular V-Pop, K-Pop, J-Pop, C-Pop, and US-UK artists to `{ region, primaryGenre, subGenres, relatedArtists }`.
   - Accurately classifies artists who use English titles or unaccented names (e.g. *MONO, HIEUTHUHAI, tlinh, Wxrdie, Low G, Wren Evans, Grey D, Obito, RPT MCK, Vũ, Bùi Anh Tuấn, SOOBIN, Sơn Tùng M-TP, Phương Ly, Hoàng Dũng, Da LAB, Chillies, Ngọt, Cá Hồi Hoang* → `vn`; *ILLIT, BABYMONSTER, KISS OF LIFE, RIIZE, Jungkook, Jennie, Rosé, Lisa, NewJeans, aespa, IVE, LE SSERAFIM, BTS, BLACKPINK, BIGBANG, IU, TWICE, Stray Kids, SEVENTEEN* → `kr`; *YOASOBI, Fujii Kaze, Kenshi Yonezu, Ado, RADWIMPS, Official HIGE DANdism, Vaundy, Eve, LiSA, Aimer* → `jp`; *Jay Chou, G.E.M., Eric Chou, Joker Xue, Ronghao Li, Mayday, LBI利比* → `cn`).
2. **Script & Linguistic Analysis**:
   - Hangul (`[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]`) → `'kr'` (`high` confidence).
   - Hiragana / Katakana (`[\u3040-\u309f\u30a0-\u30ff]`) → `'jp'` (`high` confidence).
   - CJK Unified Ideographs (`[\u4e00-\u9faf]`) without Kana, or Chinese music keywords (`douyin`, `cpop`, `nhac hoa`, `trung quoc`, `ost hoa ngu`) → `'cn'` (`high` confidence).
   - Vietnamese diacritics OR common unaccented Vietnamese word tokens (`\b(anh|em|yeu|buon|nho|thuong|mua|nang|tinh|chuyen|nguoi|khong|mot|nhung|ngay|dem|tim|ve|xa|doi|long|dau|mat|moi|ta|minh|cho|mai|cuoi|dau)\b` with $\ge 2$ token hits) → `'vn'` (`high` confidence).
3. **Source Context Signal**:
   - If `source === 'nhaccuatui'` (or `id` starts with `nct-`) and no foreign artist/script matched → `'vn'` (`medium` confidence).
4. **ASCII Fallback**:
   - Pure ASCII title & artist with no Vietnamese token matches → `'us'` (`low` confidence if artist is unknown, `high` if in `ARTIST_PROFILES`).

#### Genre Detection & Compatibility Matrix
1. **Explicit Title/Album Keyword Signal (Highest Priority for Remixes/Acoustic/Live variations)**:
   - `'remix'`: `\b(remix|vinahouse|house|edm|club|bounce|dubstep|sped up|speed up|dj|nonstop|mixtape)\b`
   - `'indie'`: `\b(indie|acoustic|lofi|lo-fi|chill|unplugged|folk|bedroom pop)\b`
   - `'ballad'`: `\b(ballad|piano|sad|buon|tam trang|ost|sầu|lệ|khóc|chia tay)\b`
   - `'rap'`: `\b(rap|hiphop|hip-hop|trap|drill|cypher|freestyle)\b`
   - `'rnb'`: `\b(r&b|rnb|soul|melodic)\b`
2. **Artist Profile Default Genre**:
   - Uses `artistProfile.primaryGenre` and `artistProfile.subGenres` when the title does not override with `'remix'`.
   - If a Rap/Pop artist's track has `'remix'` in the title, `genre` becomes `'remix'` while preserving the artist's `primaryGenre` in `subGenres`.
3. **Genre Compatibility Matrix (`getGenreCompatibility(seed, candidate)`)**:
   - Returns a score in `[0.0, 1.0]`. A score of `0.0` is a **Hard Reject**:
     - `ballad`: `ballad` (1.0), `indie` (0.82), `pop` (0.55), `rnb` (0.50), `rap` (0.0), `remix` (0.0)
     - `indie`: `indie` (1.0), `ballad` (0.82), `rnb` (0.75), `pop` (0.55), `rap` (0.0), `remix` (0.0)
     - `rnb`: `rnb` (1.0), `indie` (0.75), `pop` (0.72), `rap` (0.70), `ballad` (0.52), `remix` (0.0)
     - `rap`: `rap` (1.0), `rnb` (0.80), `pop` (0.50), `ballad` (0.0), `indie` (0.0), `remix` (0.0)
     - `pop`: `pop` (1.0), `rnb` (0.75), `ballad` (0.60), `indie` (0.60), `rap` (0.48), `remix` (0.0)
     - `remix`: `remix` (1.0), `pop` (0.0), `rap` (0.0), `rnb` (0.0), `ballad` (0.0), `indie` (0.0)
   - Also checks `subGenres` (e.g., if `seed` has `genre: 'rap'` and `subGenres: ['rnb']`, compatibility considers the best match weighted by primary/secondary priority, while never bypassing the `'remix'` vs `'ballad'/'indie'` hard block).

---

### 2.2. Auto-Queue Engine Upgrade (`lib/queueRecommend.ts` & `lib/smartRecommend.ts`)

1. **Genre & Region-Targeted Candidate Generation**:
   - `seedProfile = classifyTrack(seedTrack)`
   - **Related Artists Queries**: Select up to 2 related artists from `seedProfile.relatedArtists` (plus top matching artist from the user's compatible listening history) to search NCT (when `seedProfile.region === 'vn'`) and SoundCloud/Deezer so the candidate pool contains genuine genre-matched peers beyond just `seedTrack.artist`.
   - **Genre + Region Topic Queries**: Search NCT/SoundCloud using `seedProfile.queryTerms[0]` (e.g., `"Vpop Ballad Tâm Trạng"`, `"Rap Việt Chill"`, `"Kpop Top Hits"`) so non-seed-artist slots are filled with on-genre tracks.
   - **Filtered Collaborative & User Taste History (`getInternalCollaborativeCandidates`)**:
     - Fetch user's completed `listen_events` and collaborative candidates, resolve their track metadata from `tracks`, and **filter them through `isTrackStyleCompatible(seedProfile, candidate)`**.
     - Extract a `userPreferredArtists` set (normalized artist names from the user's completed history that match the current `region` & `genre`) to boost personalized tracks during scoring.

2. **Strict Two-Layer Candidate Gate (`filterCandidate`)**:
   - **Region Lock**:
     - If `seedProfile.region !== 'global'`, reject any candidate where `candProfile.region !== seedProfile.region`, EXCEPT when `candProfile.regionConfidence === 'low'` AND the candidate came from `deezer_artist_radio`, `deezer_related_artist_top`, or `same_artist`.
     - If `seedProfile.region !== 'vn'`, do not query NhacCuaTui unless searching by exact `seedTrack.artist`.
   - **Genre Compatibility Lock**:
     - Compute `compat = getStyleCompatibilityScore(seedProfile, candProfile)`.
     - Reject any candidate with `compat < 0.45`.
   - **Safe Pool Fallback**:
     - If strict filtering leaves `< 4` candidates before Spotify fallback, trigger `maybeSpotifySearchFallback` using both artist and `seedProfile.queryTerms` and apply the same region/genre gate.

3. **Style-First Multi-Factor Scoring**:
   For each surviving candidate `c`:
   ```ts
   const compat = getStyleCompatibilityScore(seedProfile, candProfile) // 0.45 .. 1.0
   let score = 1.0 + compat * 0.60
   if (isSameArtist) score += 0.30
   else if (isRelatedSeedArtist) score += 0.25
   if (isUserPreferredArtist || c.source === 'internal_history') score += 0.35
   if (c.source === 'nhaccuatui') score += 0.15
   else if (c.source === 'soundcloud') score += 0.12
   else if (c.source === 'deezer') score += 0.10
   else if (c.source === 'spotify') score += 0.05
   ```
   - `diversify(candidates, { maxPerArtist: 2 })` and `injectExplorationSlots(ranked, { exploreRatio: 0.2 })` run on the strictly filtered and style-scored pool.

---

### 2.3. Context-Aware Queue Controller & UI Lists (`lib/playback/queueController.ts`, `components/track/TrackList.tsx`, `app/(app)/page.tsx`)

1. **`prepareSearchTrack` in [`lib/playback/queueController.ts`](file:///d:/MusicWeb/lib/playback/queueController.ts)**:
   - When the user plays a track from Search while a queue already exists:
     - Keep `prefix = queue.slice(0, currentIndex + 1)` (if `currentIndex >= 0`).
     - Filter `suffix = queue.slice(currentIndex + 1)` using `isTrackStyleCompatible(track, item)`.
     - Construct `newQueue = deduplicateQueueTracks([...prefix, track, ...compatibleSuffix])`.
     - When `compatibleSuffix.length <= 2`, `preparePlayTrack` will see `targetIndex >= nextQueue.length - 2 || nextQueue.length <= 5` and immediately set `shouldSmartFill = true`, fetching a fresh 12-track queue tailored to the searched track's genre and region.

2. **Style-Coherent Queue Builder for Mixed Lists (`buildStyleCoherentQueue(seedTrack, pool)`)**:
   - Exported from [`lib/trackClassifier.ts`](file:///d:/MusicWeb/lib/trackClassifier.ts).
   - Given a `seedTrack` clicked by the user and a mixed `pool: Track[]`:
     - Places `seedTrack` at index `0`.
     - Filters remaining tracks in `pool` via `isTrackStyleCompatible(seedTrack, candidate)` and sorts compatible tracks by style compatibility score descending (preserving relative order on ties).
     - Used in [`components/track/TrackList.tsx`](file:///d:/MusicWeb/components/track/TrackList.tsx) when `preserveQueueOrder` is `false` (default for Home Library, Recently Played, Drive, and Search), and in [`app/(app)/page.tsx`](file:///d:/MusicWeb/app/(app)/page.tsx) when clicking a track card in Trending or Drive grids.
     - Explicit Playlists (`/playlist/[id]`) and Albums (`/album/[id]`) pass `preserveQueueOrder={true}` (or call `playTrack` with album tracks directly) so album/playlist order is never altered.

3. **Style-Aware Shuffle in `selectNext` ([`lib/playback/queueController.ts`](file:///d:/MusicWeb/lib/playback/queueController.ts))**:
   - When `isShuffle && queue.length > 1` and `currentTrack` is present:
     - Partition background-playable candidates into `styleMatchedCandidates` (`isTrackStyleCompatible(currentTrack, t)`) and `otherPlayableCandidates`.
     - Pick randomly from `styleMatchedCandidates` first; fall back to `otherPlayableCandidates`, then `fallbackCandidates`.

---

## 3. Error Handling & Edge Cases

- **Unclassified / Instrumental / Local Files with Sparse Metadata**:
  - If a local/Drive track has `region === 'global'` and `regionConfidence === 'low'`, `isTrackStyleCompatible` permits tracks of the same genre or `global`/`vn` without rejecting everything, ensuring local files with generic names still get recommendations.
- **Small Mixed Pool (`buildStyleCoherentQueue` returns 1–5 tracks)**:
  - Because `seedTrack` is placed at `index = 0` and `nextQueue.length <= 5`, `preparePlayTrack` sets `shouldSmartFill = true`, seamlessly appending 12 style-matched recommendations from `/api/queue/next` in the background.

---

## 4. Verification & Testing Plan

1. **Unit Tests (`lib/__tests__/trackClassifier.test.ts`)**:
   - Verify region detection across V-Pop (accented, unaccented, English-titled V-Pop like *MONO - Waiting For You*, *HIEUTHUHAI - Exit Sign*), K-Pop, J-Pop, C-Pop, and US-UK.
   - Verify genre classification and compatibility matrix (e.g., `ballad` rejects `remix` and `rap`; `remix` rejects `ballad`; `ballad` accepts `ballad` and `indie`).
   - Verify `buildStyleCoherentQueue` filters out mismatched regions/genres and places `seedTrack` at index `0`.
2. **Unit Tests (`lib/__tests__/queueRecommend.test.ts`)**:
   - Verify `buildNextQueue` filters out cross-region and incompatible-genre candidates and ranks style-matched candidates above raw source bonuses.
3. **Unit Tests (`lib/playback/__tests__/queueController.test.ts`)**:
   - Verify `prepareSearchTrack` prunes incompatible trailing tracks so switching from a US-UK track to a V-Pop Ballad triggers `shouldSmartFill`.
   - Verify all existing playback and queue controller tests continue to pass.
