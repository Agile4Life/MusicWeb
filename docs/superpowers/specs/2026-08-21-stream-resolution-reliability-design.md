# Stream Resolution Reliability Design

**Goal:** Reduce cold-play latency without letting an unavailable third-party source block playback, while preserving the existing source preference and playback race guards.

## Scope

This change covers only application-code behaviour:

- Retry transient NCT failures correctly.
- Stop catalog resolution from waiting for every external search before returning a usable result.
- Return the first valid YouTube/Piped stream rather than waiting for every Piped instance.
- Bound NCT prewarm concurrency.

R2 seeding, Worker deployment verification, and secret rotation are explicitly out of scope for this change.

## Architecture

### Retry contract

`fetchWithRetry` will retry both rejected operations and returned `Response` values only when a supplied predicate classifies the outcome as transient.  NCT callers will classify network/timeout errors and HTTP 500/502/503/504 as transient, never retry 4xx responses, and retain the existing two-retry limit and exponential backoff.

### Catalog resolver

Drive remains a synchronous first choice.  For catalog tracks, NCT, YouTube, and SoundCloud searches begin concurrently.  Each candidate is accepted only after it returns a non-null `L1Entry`.  The resolver waits briefly for a preferred NCT match; if it is not ready, it returns the first valid lower-priority candidate rather than awaiting all searches.  A bounded decision deadline prevents an unresponsive source from extending the request indefinitely.  Existing route response shapes and client cache contracts remain unchanged.

### YouTube resolver

The existing resolver order stays intact for `yt-dlp`, Android InnerTube and `ytdl-core`.  Piped instances are changed from `Promise.allSettled` to a first-valid-result race: a no-stream result is treated as a failed candidate, and a usable stream wins immediately.  This prevents a fast Piped result being delayed by other instances' 3.5-second timeouts.

### Prewarm

NCT prewarm remains best-effort.  It processes at most two requests concurrently instead of launching up to ten at once.  Drive prewarm behaviour is unchanged.

## Error Handling and Safety

- A failed resolver must resolve to `null` rather than reject the public API.
- No accepted source is replaced after it is returned.
- Existing playback request-id guards remain the authority for discarding stale client results.
- No external stream URL is persisted beyond its existing source-specific cache lifetime.

## Tests

- Verify `fetchWithRetry` retries a transient `Response`, retries a thrown timeout/network error, and stops on a 4xx response.
- Verify catalog resolution does not wait for a deliberately slow lower-priority provider after a valid candidate exists; preserve NCT preference when it arrives within the grace period.
- Verify Piped resolution returns after the first valid Piped response, not after all candidates settle.
- Verify the prewarm scheduler never has more than two active NCT prewarms and still processes every selected track.

## Success Criteria

- NCT retries reflect the documented policy in production code and tests.
- A slow resolver cannot force catalog resolution to await all parallel providers.
- A fast valid Piped source is returned immediately.
- NCT prewarm does not exceed two concurrent requests.
- Targeted tests, lint, and the deterministic test suite pass. Network-dependent tests are excluded from the acceptance signal until converted to fixtures.
