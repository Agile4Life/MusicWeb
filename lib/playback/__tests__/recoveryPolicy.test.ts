import { describe, expect, it } from 'vitest';
import { createRecoveryPolicy } from '@/lib/playback/recoveryPolicy';
import { makeTrack } from './fixtures';

describe('recoveryPolicy', () => {
  it('switches NCT worker errors to local Next.js proxy once before falling back to YouTube', () => {
    const policy = createRecoveryPolicy();
    const nctTrack = makeTrack('nct-1', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'song123',
    });

    const first = policy.decideHtml5Error({
      requestId: 10,
      track: nctTrack,
      currentSrc: 'https://worker.example.dev/stream?id=song123',
    });
    expect(first).toEqual({
      type: 'retry-nct-proxy',
      fallbackUrl: '/api/nhaccuatui/stream?id=song123',
    });

    const second = policy.decideHtml5Error({
      requestId: 10,
      track: nctTrack,
      currentSrc: 'http://localhost:3000/api/nhaccuatui/stream?id=song123',
    });
    expect(second).toEqual({
      type: 'fallback-to-youtube',
    });
  });

  it('refreshes SoundCloud stream once on error or stall before falling back to YouTube', () => {
    const policy = createRecoveryPolicy();
    const scTrack = makeTrack('sc-1', {
      source: 'soundcloud',
      soundcloud_id: '998877',
    });

    expect(
      policy.decideHtml5Error({
        requestId: 20,
        track: scTrack,
        currentSrc: 'https://cf-media.sndcdn.com/expired.mp3',
      })
    ).toEqual({ type: 'retry-soundcloud-fresh' });

    expect(
      policy.decideHtml5Error({
        requestId: 20,
        track: scTrack,
        currentSrc: 'https://cf-media.sndcdn.com/expired2.mp3',
      })
    ).toEqual({ type: 'fallback-to-youtube' });

    expect(policy.decideStall({ requestId: 21, track: scTrack })).toEqual({
      type: 'refresh-soundcloud',
    });
    expect(policy.decideStall({ requestId: 21, track: scTrack })).toEqual({
      type: 'fallback-to-youtube',
    });
  });

  it('trips circuit breaker after 4 consecutive unrecoverable failures', () => {
    const policy = createRecoveryPolicy(4);

    for (let i = 1; i <= 3; i++) {
      const res = policy.recordUnrecoverableFailure({
        trackTitle: `Song ${i}`,
        queueLength: 5,
        autoPlayNext: true,
        repeatMode: 'off',
      });
      expect(res.circuitBroken).toBe(false);
      expect(res.shouldAutoSkip).toBe(true);
    }

    const fourth = policy.recordUnrecoverableFailure({
      trackTitle: 'Song 4',
      queueLength: 5,
      autoPlayNext: true,
      repeatMode: 'off',
    });
    expect(fourth.circuitBroken).toBe(true);
    expect(fourth.shouldAutoSkip).toBe(false);
    expect(fourth.error).toContain('4 bài hát liên tiếp');
  });
});
