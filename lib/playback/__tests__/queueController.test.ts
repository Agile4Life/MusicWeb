import { describe, expect, it } from 'vitest';
import { createQueueController } from '@/lib/playback/queueController';
import { makeTrack } from './fixtures';

describe('queueController', () => {
  it('prepares playTrack transitions and records played history while clearing forward history on manual selection', () => {
    const qc = createQueueController({ random: () => 0 });
    const t1 = makeTrack('t-1');
    const t2 = makeTrack('t-2');
    const t3 = makeTrack('t-3');

    const first = qc.preparePlayTrack({
      track: t1,
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      newQueue: [t1, t2, t3],
    });
    expect(first.currentIndex).toBe(0);
    expect(first.queue.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3']);

    const second = qc.preparePlayTrack({
      track: t2,
      queue: first.queue,
      currentIndex: first.currentIndex,
      currentTrack: t1,
    });
    expect(second.currentIndex).toBe(1);
    expect(qc.getHistoryStacks().played.map((t) => t.id)).toEqual(['t-1']);
  });

  it('restarts track when prevTrack is pressed after 3s, and pops history stack on double-click', () => {
    const qc = createQueueController({ random: () => 0 });
    const t1 = makeTrack('t-1');
    const t2 = makeTrack('t-2');
    const queue = [t1, t2];

    qc.preparePlayTrack({
      track: t1,
      queue,
      currentIndex: 0,
      currentTrack: null,
    });
    qc.preparePlayTrack({
      track: t2,
      queue,
      currentIndex: 0,
      currentTrack: t1,
    });

    const firstPrev = qc.selectPrevious({
      queue,
      currentIndex: 1,
      currentTrack: t2,
      isShuffle: false,
      activeTime: 10,
      now: 5000,
    });
    expect(firstPrev).toEqual({ action: 'restart' });

    const secondPrev = qc.selectPrevious({
      queue,
      currentIndex: 1,
      currentTrack: t2,
      isShuffle: false,
      activeTime: 10,
      now: 6000,
    });
    expect(secondPrev).toEqual({
      action: 'play',
      track: t1,
      index: 0,
    });

    // Forward history now contains t2 so selectNext restores t2 first
    const nextAfterPrev = qc.selectNext({
      queue,
      currentIndex: 0,
      currentTrack: t1,
      isShuffle: false,
    });
    expect(nextAfterPrev).toEqual({
      action: 'play',
      track: t2,
      index: 1,
      shouldSmartFill: true,
    });
  });

  it('prefers background-playable tracks during shuffle when queue has unresolved catalog items', () => {
    const qc = createQueueController({ random: () => 0 });
    const current = makeTrack('cur', { source: 'local' });
    const unresolvedCatalog = makeTrack('sp-only', {
      source: 'spotify',
      spotify_id: 'sp123456',
      file_path: '',
    });
    const nctPlayable = makeTrack('nct-1', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-abc',
    });

    const decision = qc.selectNext({
      queue: [current, unresolvedCatalog, nctPlayable],
      currentIndex: 0,
      currentTrack: current,
      isShuffle: true,
    });

    expect(decision).toEqual({
      action: 'play',
      track: nctPlayable,
      index: 2,
      shouldSmartFill: true,
    });
  });

  it('handles addToQueue, removeFromQueue, and clearQueue accurately', () => {
    const qc = createQueueController();
    const t1 = makeTrack('t-1');
    const t2 = makeTrack('t-2');
    const t3 = makeTrack('t-3');

    const withAdded = qc.addToQueue([t1, t3], 0, t2);
    expect(withAdded.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3']);

    const removedBefore = qc.removeFromQueue(withAdded, 2, 0);
    expect(removedBefore.currentIndex).toBe(1);
    expect(removedBefore.removedCurrent).toBe(false);

    const removedCurrent = qc.removeFromQueue(removedBefore.queue, 1, 1);
    expect(removedCurrent.removedCurrent).toBe(true);
    expect(removedCurrent.currentIndex).toBe(0);
    expect(removedCurrent.nextTrack?.id).toBe('t-2');

    expect(qc.clearQueue(t2)).toEqual({
      queue: [t2],
      currentIndex: 0,
    });
  });

  it('prunes incompatible trailing tracks in prepareSearchTrack when switching region/genre', () => {
    const qc = createQueueController();
    const us1 = makeTrack('us-1', { title: 'Blinding Lights', artist: 'The Weeknd' });
    const us2 = makeTrack('us-2', { title: 'Cruel Summer', artist: 'Taylor Swift' });
    const us3 = makeTrack('us-3', { title: 'Starboy', artist: 'The Weeknd' });
    const vnBallad = makeTrack('vn-1', { title: 'Hẹn Một Mai', artist: 'Bùi Anh Tuấn' });
    const vnBallad2 = makeTrack('vn-2', { title: 'Trót Yêu', artist: 'Trung Quân' });

    const plan = qc.prepareSearchTrack({
      track: vnBallad,
      queue: [us1, us2, us3, vnBallad2],
      currentIndex: 0,
    });

    // Prefix (us1) is kept, vnBallad is inserted at index 1, incompatible trailing US tracks (us2, us3) are pruned, compatible vnBallad2 is kept
    expect(plan.forceIndex).toBe(1);
    expect(plan.newQueue?.map((t) => t.id)).toEqual(['us-1', 'vn-1', 'vn-2']);
  });

  it('prefers style-compatible tracks during shuffle when queue contains mixed regions/genres', () => {
    const qc = createQueueController({ random: () => 0 });
    const currentVnBallad = makeTrack('vn-cur', {
      title: 'Hẹn Một Mai',
      artist: 'Bùi Anh Tuấn',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-cur',
    });
    const usPop = makeTrack('us-pop', {
      title: 'Cruel Summer',
      artist: 'Taylor Swift',
      source: 'soundcloud',
      soundcloud_id: 111,
    });
    const vnRemix = makeTrack('vn-remix', {
      title: 'Bay Lắc (Vinahouse Remix)',
      artist: 'DJ Việt',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-remix',
    });
    const vnBalladPeer = makeTrack('vn-peer', {
      title: 'Trót Yêu',
      artist: 'Trung Quân',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-peer',
    });

    const decision = qc.selectNext({
      queue: [currentVnBallad, usPop, vnRemix, vnBalladPeer],
      currentIndex: 0,
      currentTrack: currentVnBallad,
      isShuffle: true,
    });

    expect(decision).toEqual({
      action: 'play',
      track: vnBalladPeer,
      index: 3,
      shouldSmartFill: true,
    });
  });
});

