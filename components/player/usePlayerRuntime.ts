import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from '@/components/ui/ToastContext';
import type { PlaybackController } from '@/lib/playback/controllerTypes';
import { bindPlaybackProgressStore } from './PlaybackProgressStore';
import { createPlayerViewStore, type PlayerViewSlices } from './playerViewStore';
import { createPlayerRuntime, type PlayerRuntime } from './runtime/createPlayerRuntime';

export interface UsePlayerRuntimeOptions {
  runtime?: PlayerRuntime;
  controller?: PlaybackController;
}

export interface UsePlayerRuntimeResult {
  slices: PlayerViewSlices;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  effectiveDuration: number;
}

export function usePlayerRuntime(
  options: UsePlayerRuntimeOptions = {}
): UsePlayerRuntimeResult {
  const { data: nextAuthSession } = useSession();
  const frequencyData = useMemo(() => new Uint8Array(16), []);

  const [ownedRuntime] = useState<PlayerRuntime | null>(() =>
    !options.runtime && !options.controller ? createPlayerRuntime() : null
  );

  const activeRuntime = options.runtime ?? ownedRuntime;
  const controller = options.controller ?? activeRuntime!.controller;

  const viewStore = useMemo(
    () =>
      createPlayerViewStore(controller, {
        frequencyData,
      }),
    [controller, frequencyData]
  );

  const slices = useSyncExternalStore(
    viewStore.subscribe,
    viewStore.getSlices,
    viewStore.getSlices
  );

  const progress = useSyncExternalStore(
    controller.subscribeProgress,
    controller.getProgress,
    controller.getProgress
  );

  useEffect(() => {
    activeRuntime?.setActiveUserEmail(nextAuthSession?.user?.email);
  }, [activeRuntime, nextAuthSession]);

  useEffect(() => {
    return bindPlaybackProgressStore(controller);
  }, [controller]);

  useEffect(() => {
    if (!activeRuntime) return;
    const detachAudio = activeRuntime.attachAudioElement(viewStore.audioRef.current);
    return () => {
      detachAudio();
    };
  }, [activeRuntime, viewStore]);

  useEffect(() => {
    return () => {
      ownedRuntime?.dispose();
    };
  }, [ownedRuntime]);

  useEffect(() => {
    if (slices.track.playbackError) {
      toast(slices.track.playbackError, 'error');
    }
  }, [slices.track.playbackError]);

  useEffect(() => {
    if (!slices.track.isPlaying) {
      frequencyData.fill(0);
      return;
    }
    let animId: number;

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        animId = requestAnimationFrame(tick);
        return;
      }
      const now = Date.now() / 120;
      for (let i = 0; i < 16; i++) {
        frequencyData[i] = Math.floor(
          Math.sin(now + i * 0.8) * 80 + 150 + Math.random() * 25
        );
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [slices.track.isPlaying, frequencyData]);

  const effectiveDuration =
    progress.duration > 0
      ? progress.duration
      : slices.track.currentTrack?.duration || 0;

  return {
    slices,
    audioRef: viewStore.audioRef,
    effectiveDuration,
  };
}
