# Đánh Giá Toàn Diện Flow Phát Nhạc, Cơ Chế Fallback & Matching Bài Hát

**Ngày đánh giá:** 2026-10-14  
**Phạm vi:** Toàn bộ pipeline phát nhạc từ Client (`PlayerContext`, `resolveStreamClient`, `playbackPersistence`, `audioSourceSwitch`) đến Server API (`/api/resolve-stream`, `/api/search`, `/api/nhaccuatui/*`, `/api/soundcloud/*`, `/api/yt-stream`) và các bộ lọc matching (`catalogMatching`, `nhaccuatui`, `youtube`, `soundcloud`, `driveTracksMap`, `catalogResolutionRace`).

---

## 1. Tổng Quan Kiến Trúc & Các Điểm Mạnh Hiện Tại

Kiến trúc phát nhạc hiện tại của `MusicWeb` đã được đầu tư bài bản với nhiều cơ chế tối ưu đáng ghi nhận:

1. **Chống Race Condition đa tầng (Request Ownership & Generation Guards):**
   - Sử dụng `playRequestRef`, `audioGenerationRef`, `audioOwnershipRef` và `SupersedableRequest` trong [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx) kết hợp với [`lib/playbackDecisions.ts`](file:///D:/MusicWeb/lib/playbackDecisions.ts) giúp chặn triệt để tình trạng nhạc cũ đè nhạc mới khi người dùng bấm chuyển bài liên tục.
   - Cơ chế `monotonic sharedGeneration` trong [`lib/serverStreamResolutionCache.ts`](file:///D:/MusicWeb/lib/serverStreamResolutionCache.ts#L56-L108) ngăn chặn kết quả resolve cũ ghi đè lên cache mới sau khi xảy ra `invalidate`.
2. **Đua nguồn phát có cửa sổ ưu tiên (`Priority Race with Grace Window`):**
   - [`resolveCatalogCandidates`](file:///D:/MusicWeb/lib/catalogResolutionRace.ts#L8-L61) chạy song song NhacCuaTui (NCT), SoundCloud và YouTube nhưng dành cửa sổ ưu tiên `1000ms` cho NCT, đồng thời hỗ trợ `onLatePreferredResult` để cập nhật ngầm cache khi NCT trả kết quả muộn.
3. **Caching đa tầng (L1 Memory + In-Flight Deduplication + L2 Supabase RPC + Edge Worker):**
   - Giảm thiểu tối đa các request trùng lặp ở cả client ([`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts)) lẫn server ([`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts)).
4. **Tương thích đa nền tảng (iOS Background Play & Tab Throttling):**
   - Tự động chuyển hướng YouTube trên iOS sang luồng HTML5 `<audio>` qua proxy `/api/yt-stream` để giữ nhạc chạy nền và điều khiển trên Lock Screen.
   - Sử dụng `backgroundCompletionWorker.js` và `nearEndWatchdogRef` để tránh lỗi trình duyệt throttle tab ẩn làm kẹt chuyển bài cuối track.

---

## 2. Các Điểm Nghẽn & Lỗi Cần Cải Thiện Ở Cơ Chế Matching Bài Hát

### 2.1. [Nghiêm trọng] Lỗi False-Positive trong `findMemoryDriveTrack` (Nhận nhầm nhạc MCK cho mọi nghệ sĩ khác)
- **Vị trí:** [`lib/driveTracksMap.ts`](file:///D:/MusicWeb/lib/driveTracksMap.ts#L312-L348)
- **Nguyên nhân:**
  ```ts
  // lib/driveTracksMap.ts:329-338
  const titleMatch = tTitle === normTitle || tTitle.includes(normTitle) || normTitle.includes(tTitle);
  if (titleMatch) {
    if (normArtist) {
      const artistMatch =
        tArtist === normArtist ||
        tArtist.includes(normArtist) ||
        normArtist.includes(tArtist) ||
        normArtist.includes('mck') ||
        tArtist.includes('mck'); // <-- LUÔN TRUE!
  ```
  - Toàn bộ 30 bài trong `STATIC_DRIVE_TRACKS` đều có `t.artist === "MCK"` (`tArtist === "mck"`). Do đó biểu thức `tArtist.includes('mck')` **luôn luôn bằng `true` với mọi phần tử trong mảng**, khiến việc kiểm tra tên nghệ sĩ (`artistMatch`) bị vô hiệu hóa hoàn toàn!
  - Kết hợp với `titleMatch` dùng `.includes()` 2 chiều không có ranh giới từ (word boundary) và trong danh sách có các tên bài rất ngắn như `"Baby"`, `"IDK"`, `"Cảm Ơn"`, `"Liệm"`, `"Huh"`, bất kỳ bài hát nào của nghệ sĩ quốc tế hay V-Pop có chứa chữ `"baby"` (VD: *Baby - Justin Bieber*), `"cảm ơn"` (VD: *Cảm Ơn Tình Yêu*), `"ai"`... đều sẽ bị khớp nhầm sang nhạc Drive của MCK ở **0ms** tại cả Client ([`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L116)) lẫn Server ([`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L177)).
  - Tương tự, bước tra cứu bảng `tracks` trên Supabase trong [`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L193-L221) cũng đang dùng `.includes()` hai chiều mà không kiểm tra `hasIncompatiblePlaybackVariant` hay độ lệch `duration`.
- **Giải pháp đề xuất:**
  - Xóa bỏ điều kiện `|| tArtist.includes('mck')` trong [`findMemoryDriveTrack`](file:///D:/MusicWeb/lib/driveTracksMap.ts#L338).
  - Yêu cầu khớp nghệ sĩ chặt chẽ (tách token nghệ sĩ hoặc khớp chính xác alias của MCK như `mck`, `rpt mck`, `ngơ`, `ngethach`) và chỉ cho phép substring trên tiêu đề khi độ dài chuỗi đủ lớn kèm kiểm tra ranh giới từ (`containsPhrase`) + `hasIncompatiblePlaybackVariant`.

---

### 2.2. [Cao] Lỗi mất chữ `"Đ/đ"` tiếng Việt và xóa trắng ký tự Non-Latin (Hàn/Nhật/Trung) trong `normalizeNhacCuaTuiText`
- **Vị trí:** [`lib/nhaccuatui.ts`](file:///D:/MusicWeb/lib/nhaccuatui.ts#L77-L86)
- **Nguyên nhân:**
  ```ts
  // lib/nhaccuatui.ts:77-86
  export function normalizeNhacCuaTuiText(text: string): string {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // KHÔNG tách được chữ Đ/đ (U+0110 / U+0111)
      .replace(/[^a-z0-9]+/g, ' ')     // Biến chữ 'đ' và chữ tượng hình thành khoảng trắng!
      .replace(/\s+/g, ' ')
      .trim();
  }
  ```
  - Trong chuẩn Unicode, `.normalize('NFD')` không phân tách ký tự `Đ/đ`. Vì thiếu `.replace(/[Đđ]/g, 'd')` trước `.replace(/[^a-z0-9]+/g, ' ')`, mọi chữ `đ` đều bị biến thành khoảng trắng:
    - `"Đen"` $\rightarrow$ `"en"` (`splitTokens` lọc bỏ vì `< 2` ký tự hoặc khớp nhầm vào các từ có đuôi `"en"`).
    - `"Đừng Làm Trái Tim Anh Đau"` $\rightarrow$ `"ung lam trai tim anh au"`.
    - `"Đom Đóm"` $\rightarrow$ `"om om"`.
  - Ngoài ra, regex `[^a-z0-9]+` xóa sạch hoàn toàn bảng chữ cái tiếng Hàn (Hangul), tiếng Nhật (Kanji/Kana), tiếng Trung (CJK) về chuỗi rỗng `""`, làm `findBestNhacCuaTuiMatch` trả về `null` cho các bài nhạc châu Á không dùng tiêu đề Latin.
- **Giải pháp đề xuất:**
  - Đồng bộ logic chuẩn hóa về cùng chuẩn với [`normalizeIdentity`](file:///D:/MusicWeb/lib/catalogMatching.ts#L8-L18): thêm `.replace(/đ/g, 'd')` và dùng regex Unicode Property Escapes `/[^\p{L}\p{N}\s]/gu` thay vì `/[^a-z0-9]+/g`.

---

### 2.3. [Cao] Nhánh Emergency Search Fallback và `fallbackToYouTube` bỏ qua toàn bộ bộ lọc Matching
- **Vị trí:**
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L2087-L2139) (Emergency fallback trong `playTrack`)
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1152) (NCT fallback trong `fallbackToYouTube`)
- **Nguyên nhân:**
  - Trong `playTrack` (dòng 2103–2105), khi `/api/resolve-stream` trả về `null` (do các ứng viên đều bị bộ lọc từ chối vì lệch duration, sai ca sĩ, hoặc là bản cover/karaoke), client gọi tiếp `/api/search?q=...&source=all` và **lấy thẳng phần tử đầu tiên**:
    ```ts
    const nctPick = fbData.nhaccuatui?.[0];
    const ytPick = fbData.youtube?.[0];
    const scPick = fbData.soundcloud?.[0];
    ```
    Việc này vô tình phát chính kết quả rác (nhạc chế, karaoke, sai ca sĩ, podcast dài 1 tiếng) mà `/api/resolve-stream` vừa cố công loại bỏ.
  - Tương tự, tại [`fallbackToYouTube`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1152):
    ```ts
    const nctCandidate = (data.nhaccuatui || []).find((t: Track) => t.nhaccuatui_id && t.nhaccuatui_id !== track.nhaccuatui_id);
    ```
    Chỉ kiểm tra khác ID chứ không chạy qua `findBestNhacCuaTuiMatch`, rất dễ bốc nhầm bài khác của cùng ca sĩ hoặc bản cover/beat.
- **Giải pháp đề xuất:**
  - Áp dụng `findBestNhacCuaTuiMatch`, `findBestYouTubeMatch`, và `isSoundCloudCatalogMatch` cho cả kết quả trả về từ `/api/search` ở nhánh fallback (có thể nới nhẹ ngưỡng điểm một chút nếu cần, nhưng bắt buộc giữ kiểm tra `hasIncompatiblePlaybackVariant`, khớp artist/title tối thiểu và giới hạn duration).

---

### 2.4. [Trung bình] SoundCloud Matching dùng `.find()` thay vì chấm điểm & bẫy chuỗi con ngược (`containsPhrase(targetTitle, title)`)
- **Vị trí:** [`lib/catalogMatching.ts`](file:///D:/MusicWeb/lib/catalogMatching.ts#L56-L64) và [`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L312)
- **Nguyên nhân:**
  - Trong [`isSoundCloudCatalogMatch`](file:///D:/MusicWeb/lib/catalogMatching.ts#L60):
    ```ts
    const titleMatches =
      title === targetTitle ||
      containsPhrase(title, targetTitle) ||
      containsPhrase(targetTitle, title);
    ```
    Nếu bài mục tiêu có tên dài (VD: `"Anh Đã Quen Với Cô Đơn"`), còn một track bất kỳ trên SoundCloud có tiêu đề ngắn chỉ 1 từ (VD: `"Anh"` hoặc `"Cô Đơn"`) của cùng ca sĩ, `containsPhrase(targetTitle, title)` sẽ trả về `true`!
  - Hơn nữa, [`trySoundCloud`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L312) dùng `candidates.find(...)` (lấy kết quả đầu tiên vượt qua điều kiện boolean) thay vì chấm điểm (scoring) độ khớp tiêu đề + độ lệch thời lượng như NCT và YouTube.
- **Giải pháp đề xuất:**
  - Chỉ cho phép `containsPhrase(targetTitle, title)` khi `title` có ít nhất 2–3 từ hoặc chiếm $\ge 60\%$ độ dài của `targetTitle`.
  - Chuyển `isSoundCloudCatalogMatch` sang hàm chấm điểm `findBestSoundCloudMatch(candidates, target)` ưu tiên bài khớp chính xác tiêu đề + artist và có chênh lệch `duration` nhỏ nhất.

---

### 2.5. [Trung bình] Khớp chuỗi con trên từng từ đơn ngắn & thiếu chuẩn hóa hậu tố Spotify/Apple Music
- **Vị trí:**
  - [`lib/nhaccuatui.ts`](file:///D:/MusicWeb/lib/nhaccuatui.ts#L265) (`measureTokenOverlap`)
  - [`lib/youtube.ts`](file:///D:/MusicWeb/lib/youtube.ts#L375-L387) (`normalizeTitle`) & [`lib/youtube.ts`](file:///D:/MusicWeb/lib/youtube.ts#L464)
  - [`lib/catalogMatching.ts`](file:///D:/MusicWeb/lib/catalogMatching.ts#L36-L40) (`PLAYBACK_VARIANT_MARKERS`)
- **Nguyên nhân:**
  1. `candidate.includes(token)` trong [`lib/nhaccuatui.ts`](file:///D:/MusicWeb/lib/nhaccuatui.ts#L265) và `candidateTitleNorm.includes(word)` trong [`lib/youtube.ts`](file:///D:/MusicWeb/lib/youtube.ts#L464) kiểm tra chuỗi con mà không có ranh giới từ. Với tiếng Việt nhiều từ đơn ngắn (`"anh"`, `"em"`, `"ai"`, `"ta"`, `"la"`), `"anh"` sẽ khớp vào `"thanh"`, `"nhanh"`; `"em"` khớp vào `"xem"`, `"đêm"`; `"ai"` khớp vào `"tai"`, `"sai"`.
  2. [`normalizeTitle`](file:///D:/MusicWeb/lib/youtube.ts#L375-L387) chỉ xóa `(Official Video)`, `[MV]`, `(Lyrics)`... nhưng chưa xóa các hậu tố phổ biến từ catalog Spotify/Last.fm/Apple Music như `- Remastered 2023`, `(2021 Remaster)`, `- Radio Edit`, `- Single Version`, `- From "..."`. Điều này làm `normCandidate.includes(normTarget)` bị trượt và trừ điểm oan.
  3. Danh sách [`PLAYBACK_VARIANT_MARKERS`](file:///D:/MusicWeb/lib/catalogMatching.ts#L36-L40) nên bổ sung thêm các biến thể hay gặp tại Việt Nam: `'demo'`, `'parody'`, `'nhạc chế'`, `'ai cover'`, `'guitar version'`, `'piano version'`, `'nhạc chuông'`, `'ringtone'`, `'tách lời'`, `'medley'`, `'liên khúc'`.

---

## 3. Các Điểm Nghẽn & Lỗi Cần Cải Thiện Ở Cơ Chế Fallback & Phát Nhạc

### 3.1. [Nghiêm trọng] `tryNct()` trong `/api/resolve-stream` thắng cuộc đua nhưng không kiểm tra bài hát có stream thật (`audioUrl`) hay không
- **Vị trí:** [`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L250-L273)
- **Nguyên nhân:**
  ```ts
  // app/api/resolve-stream/route.ts:250-272
  const tryNct = async (): Promise<ResolvedStream | null> => {
    const candidates = await searchNhacCuaTuiTracks(query, 8);
    const match = findBestNhacCuaTuiMatch(candidates, { ... });
    if (!match?.id) return null;
    return {
      source: 'nhaccuatui',
      streamUrl: `/api/nhaccuatui/stream?id=${encodeURIComponent(match.id)}`,
      ...
    };
  };
  ```
  - `tryNct()` chỉ dừng lại ở bước tìm kiếm metadata (`/api/search` của NCT) và kiểm tra `match.id` chứ **không gọi lấy chi tiết bài hát (`getNhacCuaTuiTrackDetail`) để xác nhận có `audioUrl` hợp lệ**.
  - Thực tế trên NCT có rất nhiều bài (đặc biệt là nhạc US-UK, K-Pop, hoặc nhạc bản quyền VIP) vẫn xuất hiện đầy đủ trong kết quả search với tên bài/ca sĩ khớp 100%, nhưng khi gọi lấy link stream thì `audioUrl` bị rỗng (`404 Not Found` / `502`).
  - **Hậu quả dây chuyền:**
    1. Trong cuộc đua [`resolveCatalogCandidates`](file:///D:/MusicWeb/lib/catalogResolutionRace.ts), NCT được ưu tiên tuyệt đối (grace window `1000ms`), nên nó **thắng cuộc đua** và loại bỏ luôn kết quả SoundCloud/YouTube hợp lệ.
    2. Thậm chí nếu NCT về muộn sau 1000ms, callback [`onLatePreferredResult`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L485-L490) sẽ **ghi đè kết quả NCT lỗi này đè lên kết quả YouTube/SoundCloud đang chạy tốt trong cả L1 và L2 Supabase cache**!
    3. Client nhận được `/api/nhaccuatui/stream?id=...`, gắn vào `<audio>`, bị lỗi `502` $\rightarrow$ nhảy vào `handleError` $\rightarrow$ thử lại NCT lần nữa $\rightarrow$ cuối cùng mới gọi `fallbackToYouTube`. Tổng thời gian trễ (latency) bị đội lên **3–5 giây**.
- **Giải pháp đề xuất:**
  - Trong `tryNct()`, gọi luôn hàm lấy stream detail (hoặc `getNhacCuaTuiStreamUrl(match.id)`) và lưu `audioUrl` vào `nctCacheStore` (`setNctAudioCache`).
  - Nếu bài hát trên NCT không có `audioUrl`, `tryNct()` trả về `null` ngay lập tức để `resolveCatalogCandidates` chuyển sang dùng kết quả SoundCloud hoặc YouTube đã chạy song song sẵn.
  - Nếu có `audioUrl`, khi trình duyệt gọi tiếp `/api/nhaccuatui/stream?id=...`, route này sẽ đọc trúng `nctCacheStore` trong bộ nhớ ở **0ms** mà không tốn thêm 1 vòng gọi mạng nào!

---

### 3.2. [Cao] Tự retry lại đúng URL `/api/nhaccuatui/stream` vừa bị lỗi trong `handleError` (Lãng phí tối đa 4 giây)
- **Vị trí:** [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L3243-L3285)
- **Nguyên nhân:**
  - Khi thẻ `<audio>` báo lỗi trên một bài có `nhaccuatui_id`, nhánh `if (currentTrack.nhaccuatui_id && !nctFallbackTriedRef.current)` được kích hoạt với ý đồ: *"Nếu Cloudflare Worker cache bị lỗi thì thử fallback về Next.js proxy `/api/nhaccuatui/stream`"*.
  - Tuy nhiên, khi không cấu hình `NEXT_PUBLIC_NCT_STREAM_CACHE_URL` hoặc khi bài hát vừa được resolve từ `/api/resolve-stream`, `audioRef.current.src` **đã chính là `/api/nhaccuatui/stream?id=...` rồi**!
  - Việc gán lại `audioRef.current.src = fallbackUrl` và gọi `.load()` khiến trình duyệt gọi lại y hệt URL vừa trả về lỗi `502`, đồng thời chờ đua timeout `NCT_RACE_TIMEOUT_MS` (lên tới 4 giây) trước khi chịu chuyển sang `fallbackToYouTube`.
- **Giải pháp đề xuất:**
  - Kiểm tra `const alreadyOnLocalProxy = isSameAudioSource(audioRef.current?.src, fallbackUrl);` trước khi retry. Nếu `alreadyOnLocalProxy === true`, bỏ qua bước nạp lại `<audio>` và chuyển thẳng kết quả `searchPromise` sang `fallbackToYouTube(currentTrack, { prefetchedSearch: searchPromise })`.

---

### 3.3. [Cao] Lệch chuẩn Cache Key giữa `resolveStreamClient.ts` (4 phần) và `playbackPersistence.ts` (3 phần) làm kẹt `youtube_id` chết
- **Vị trí:**
  - [`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L64) & [`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L235)
  - [`lib/playbackPersistence.ts`](file:///D:/MusicWeb/lib/playbackPersistence.ts#L306-L319)
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1244-L1248)
- **Nguyên nhân:**
  - `makeClientKey` trong [`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L64) tạo key gồm **4 thành phần**: `title___artist___duration___album` (thông qua `normalizeTrackKey`).
  - Trong khi đó, `makeResolutionKey` trong [`lib/playbackPersistence.ts`](file:///D:/MusicWeb/lib/playbackPersistence.ts#L306) (được dùng bởi `getCachedYouTubeId`) lại tạo key gồm **3 thành phần**: `title___artist___album` (không có `duration`).
  - Trong [`fallbackToYouTube`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1244-L1248), code ghi xuống `localStorage` cả 2 key (`keyWithDur` và `keyWithoutDur`). Nhưng khi stream bị hỏng và gọi [`invalidateStreamResolution`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L235), hàm này chỉ xóa mỗi `keyWithDur` (4 thành phần), để sót lại `keyWithoutDur` (3 thành phần) trong `localStorage` suốt 24 giờ!
  - Kết quả là ở lần phát tiếp theo, [`getCachedYouTubeId`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1946) vẫn đọc trúng `keyWithoutDur` và tiếp tục trả về `youtube_id` đã chết.
- **Giải pháp đề xuất:**
  - Trong `invalidateStreamResolution`, xóa đồng thời cả key 4 phần (`makeClientKey`) và key 3 phần (`makeResolutionKey`), hoặc hợp nhất cả hai file về dùng chung một hàm tạo key duy nhất.

---

### 3.4. [Trung bình] Xử lý lỗi YouTube IFrame Player & Quên kích hoạt Auto-Advance khi bài hát lỗi toàn tập
- **Vị trí:**
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1639-L1700) (`onError` của YouTube IFrame)
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L3375-L3391) (`handleError` của HTML5 Audio)
  - [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L756) (`pendingAutoSkipTimeoutRef`)
- **Nguyên nhân:**
  1. **Khi YouTube IFrame báo lỗi `150` / `101` (chủ sở hữu chặn nhúng IFrame - rất phổ biến với nhạc UMG/VEVO/Sony) hoặc lỗi `2` / `5`:**
     - Hiện tại `onError` chỉ tìm một video YouTube khác để nhúng lại vào IFrame. Nếu các video chính thống của bài đó trên YouTube đều chặn embed, player sẽ báo lỗi dừng phát, trong khi bài đó hoàn toàn có thể phát qua luồng **HTML5 Audio proxy (`/api/yt-stream`)**, hoặc phát từ **NhacCuaTui / SoundCloud**.
  2. **Biến `pendingAutoSkipTimeoutRef` được khai báo nhưng chưa được gắn timer tự chuyển bài:**
     - Ở cả [`PlayerContext.tsx#L1684`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1684) và [`PlayerContext.tsx#L3375`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L3375), khi mọi phương án fallback đều thất bại, code có tăng `consecutiveSkipRef.current += 1` và kiểm tra `< MAX_CONSECUTIVE_SKIPS`, nhưng bên trong block chỉ dừng ở việc `setError(...)` chứ **không đặt `pendingAutoSkipTimeoutRef.current = setTimeout(() => nextTrackRef.current(), 1500)`**.
     - Hậu quả: Nếu người dùng đang nghe một playlist dài mà gặp 1 bài lỗi nguồn phát, toàn bộ playlist sẽ bị đứng im thay vì tự động nhảy qua bài kế tiếp.

---

## 4. Các Điểm Tối Ưu Phụ Ở Luồng Prewarm & Quản Lý State

### 4.1. [Thấp] `triggerAdaptivePrewarm` bỏ sót nhánh `'soundcloud'` và chưa điền thẳng vào `audioUrlCacheRef`
- **Vị trí:** [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1032-L1056)
- **Nguyên nhân:**
  - Sau khi `resolveStreamForTrack(nextTrack)` hoàn tất, `triggerAdaptivePrewarm` kiểm tra `resolved.source === 'nhaccuatui'`, `'drive'`, và `'youtube'`, nhưng **bỏ quên nhánh `resolved.source === 'soundcloud'`**. Nếu bài tiếp theo trong queue được resolve ra SoundCloud, `soundcloud_id` không được cập nhật vào `queueRef` và `audioUrlCacheRef` không được làm nóng.
  - Ngoài ra, với các nguồn `nhaccuatui`, `drive`, `soundcloud`, nếu lưu luôn `resolved.streamUrl` vào `audioUrlCacheRef.current.set(nextTrack.id, resolved.streamUrl)`, thì khi chuyển bài tự động (`handleTrackCompletion` $\rightarrow$ `tryQuickPlayFromCache`), trình duyệt sẽ lấy được URL đồng bộ trong **0ms** mà không cần bước `await getAudioUrl()` bất đồng bộ (rất quan trọng để không bị iOS Safari chặn autoplay khi màn hình khóa).

### 4.2. [Thấp] `getAudioUrl` cho SoundCloud đang tốn thêm 1 vòng `fetch(?format=json)` không cần thiết
- **Vị trí:** [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L811-L830)
- **Nguyên nhân:**
  - Khi bài hát đã có `soundcloud_id`, `getAudioUrl` gọi `await fetch('/api/soundcloud/stream?id=...&format=json')` để lấy JSON chứa `url` rồi mới gán vào `audio.src`.
  - Trong khi đó, endpoint [`/api/soundcloud/stream`](file:///D:/MusicWeb/app/api/soundcloud/stream/route.ts#L60-L65) đã hỗ trợ sẵn `307 Temporary Redirect` trực tiếp tới stream (giống hệt `/api/nhaccuatui/stream`). Việc trả về trực tiếp `/api/soundcloud/stream?id=${track.soundcloud_id}` (hoặc Worker URL) giúp gắn `audio.src` đồng bộ ngay lập tức và giảm 1 vòng RTT.

### 4.3. [Thấp] Lưu trùng lặp trạng thái Player ở 2 key `localStorage`
- **Vị trí:** [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L147) (`musicweb_player_state`) và [`lib/playbackPersistence.ts`](file:///D:/MusicWeb/lib/playbackPersistence.ts#L21) (`musicweb_playback_v2`)
- **Nguyên nhân:** Cả hai cơ chế đều serialize `currentTrack`, `queue`, `originalQueue`, `volume`, `repeat`, `shuffle` xuống `localStorage`. Việc hợp nhất về một nguồn (`playbackPersistence.ts`) sẽ giảm chi phí `JSON.stringify` trên main thread khi queue có hàng trăm bài hát.

---

## 5. Bảng Tổng Hợp Ưu Tiên Triển Khai (Action Plan)

| Mức độ | Hạng mục | File liên quan | Tác động kỳ vọng |
| :--- | :--- | :--- | :--- |
| **P0 (Khẩn cấp)** | Sửa lỗi `tArtist.includes('mck')` luôn `true` và `.includes()` 2 chiều trong `findMemoryDriveTrack` | [`lib/driveTracksMap.ts`](file:///D:/MusicWeb/lib/driveTracksMap.ts#L312-L348)<br>[`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L193-L221) | Chấm dứt hoàn toàn lỗi phát nhầm nhạc MCK cho các bài hát có tiêu đề ngắn/chứa từ khóa trùng của nghệ sĩ khác. |
| **P0 (Khẩn cấp)** | Xác thực `audioUrl` thật và warm cache ngay trong `tryNct()` của `/api/resolve-stream` | [`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L250-L273)<br>[`lib/nhaccuatui.ts`](file:///D:/MusicWeb/lib/nhaccuatui.ts) | Loại bỏ lỗi NCT "thắng giả" (có metadata nhưng không có audio), giảm 3–5 giây trễ fallback và tăng tốc `/api/nhaccuatui/stream` lên 0ms. |
| **P1 (Cao)** | Sửa lỗi mất chữ `Đ/đ` và ký tự Hàn/Nhật/Trung trong `normalizeNhacCuaTuiText` | [`lib/nhaccuatui.ts`](file:///D:/MusicWeb/lib/nhaccuatui.ts#L77-L86) | Tăng độ chính xác khi tìm và chấm điểm nhạc Việt có chữ Đ/đ (Đen, Đạt G, Đông Nhi...) và nhạc K-Pop/J-Pop/C-Pop trên NCT. |
| **P1 (Cao)** | Bỏ qua bước tự retry vô ích trong `handleError` khi `<audio>` đã ở sẵn `/api/nhaccuatui/stream` | [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L3243-L3285) | Tiết kiệm tới 4 giây chờ timeout khi một bài NCT bị lỗi nguồn phát. |
| **P1 (Cao)** | Áp dụng bộ lọc matching cho Emergency Fallback (`playTrack`) và `fallbackToYouTube` | [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1152)<br>[`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L2087-L2139) | Ngăn chặn việc phát nhầm bản cover, karaoke, nhạc chế hoặc sai ca sĩ khi `/api/resolve-stream` trả về `null`. |
| **P1 (Cao)** | Đồng bộ xóa cả key 3 phần và 4 phần trong `invalidateStreamResolution` | [`lib/resolveStreamClient.ts`](file:///D:/MusicWeb/lib/resolveStreamClient.ts#L235)<br>[`lib/playbackPersistence.ts`](file:///D:/MusicWeb/lib/playbackPersistence.ts#L306-L319) | Tránh lặp lại việc lấy `youtube_id` đã chết từ `localStorage` suốt 24 giờ sau khi xảy ra lỗi. |
| **P2 (Trung bình)** | Chuyển SoundCloud matching sang cơ chế chấm điểm (scoring) & chặn lỗi chuỗi con ngược ngắn | [`lib/catalogMatching.ts`](file:///D:/MusicWeb/lib/catalogMatching.ts#L56-L64)<br>[`app/api/resolve-stream/route.ts`](file:///D:/MusicWeb/app/api/resolve-stream/route.ts#L312) | Chọn đúng bản thu gốc có thời lượng sát nhất trên SoundCloud thay vì lấy đại phần tử đầu tiên. |
| **P2 (Trung bình)** | Bổ sung fallback chéo cho YouTube IFrame `onError` & kích hoạt `pendingAutoSkipTimeoutRef` | [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1639-L1700)<br>[`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L3375-L3391) | Cứu được các bài YouTube chặn nhúng (`150`) và tự động chuyển bài mới nếu bài hiện tại hỏng hoàn toàn. |
| **P3 (Thấp)** | Bổ sung nhánh `'soundcloud'` + lưu `audioUrlCacheRef` trong `triggerAdaptivePrewarm` | [`components/player/PlayerContext.tsx`](file:///D:/MusicWeb/components/player/PlayerContext.tsx#L1032-L1056) | Chuyển bài tiếp theo tức thì (0ms) từ bộ nhớ đệm cho mọi nguồn phát, tối ưu cho iOS Lock Screen. |
