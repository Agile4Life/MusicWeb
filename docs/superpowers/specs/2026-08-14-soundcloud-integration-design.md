# SoundCloud Integration Design Specification

## 1. Overview & Goals
Integrate SoundCloud as a first-class music provider in MusicWeb alongside local storage, YouTube, and NhacCuaTui.

Key Requirements:
1. **Dedicated SoundCloud Page (`/soundcloud`)**:
   - Navigation item on Desktop Sidebar and Mobile Header/Drawer menu.
   - Search specifically for SoundCloud tracks.
   - Curated genre/explore tabs (Remix, Việt Mix, EDM, Lofi, Pop, Hip-Hop).
   - High-resolution artwork (`-t500x500.jpg`).
2. **100% Full Audio Filter**:
   - Strictly filter out 30-second snippets, Go+ paywalled tracks, and preview-only media.
3. **SoundCloud Badging & Tagging**:
   - Prominent, stylish SoundCloud badge (Flame Orange `#ff5500`) on all track lists, track cards, player bar, now-playing overlay, and search results.
4. **Global Search Integration**:
   - Global search on Home page (`/`) fetches and displays SoundCloud tracks in parallel with existing providers.
5. **Robust Audio Playback**:
   - Integrated into `PlayerContext.tsx` without disrupting existing YouTube, NCT, Drive, or Local audio streams.
6. **Dedicated Cloudflare Worker (`workers/soundcloud-stream-cache`)**:
   - Edge caching for resolved stream URLs and Cloudflare deployment configuration (`wrangler.toml`).
7. **Zero Regression / Safe Architecture**:
   - Defense-in-depth handling across Queue, History, Favorites, Receiptify, and Lyrics.

---

## 2. Architecture & Data Flow

```
[User Interface]
  ├── Sidebar / Mobile Menu  -->  /soundcloud page
  ├── Top Global Search Bar  -->  /api/search (includes SoundCloud)
  └── Player Bar / Overlay   -->  SoundCloud Orange Badges

[Backend / API Layer]
  ├── /api/soundcloud/search   --> SoundCloud API v2 search + Full Audio Filter
  ├── /api/soundcloud/explore  --> Top/Trending genre playlists
  └── /api/soundcloud/stream   --> Stream URL resolver + Dynamic Client ID rotation

[Cloudflare Edge Worker]
  └── workers/soundcloud-stream-cache/
        ├── wrangler.toml
        └── src/index.js (Edge caching for stream URLs + KV/Memory cache)
```

---

## 3. Full Audio Filter Logic

SoundCloud marks paywalled/Go+ tracks in several fields. A track is considered **Full Audio** if and only if:
```ts
export function isSoundCloudFullAudio(track: any): boolean {
  if (!track || !track.media?.transcodings?.length) return false
  if (track.snippet === true) return false
  if (track.policy === 'SNIPPET' || track.policy === 'BLOCK') return false
  if (track.monetization_model === 'SUB_HIGH_TIER') return false
  if (track.access === 'blocked') return false

  // Must have at least one transcoding whose URL contains /stream/ (NOT /preview/)
  const hasFullStream = track.media.transcodings.some((t: any) =>
    typeof t.url === 'string' && t.url.includes('/stream/')
  )
  return hasFullStream
}
```

---

## 4. Track Model Extension (`types/index.ts`)

```ts
export interface Track {
  ...
  source?: 'local' | 'youtube' | 'audius' | 'itunes' | 'spotify' | 'nhaccuatui' | 'deezer' | 'soundcloud'
  soundcloud_id?: string | number
  soundcloud_permalink_url?: string
}
```

---

## 5. Environment Variables & Deployment Checklist

For Vercel / Production:
- `SOUNDCLOUD_CLIENT_ID` (Optional fallback, automatically auto-resolved dynamically from soundcloud.com web scripts if omitted)
- `NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL` (Optional URL pointing to the deployed Cloudflare Worker)
