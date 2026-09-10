import { useSyncExternalStore } from 'react'

export interface PlaybackProgressState {
  currentTime: number
  duration: number
}

export class PlaybackProgressStore {
  private state: PlaybackProgressState = { currentTime: 0, duration: 0 }
  private listeners = new Set<() => void>()

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot = (): PlaybackProgressState => {
    return this.state
  }

  public setProgress = (currentTime: number, duration?: number): void => {
    const roundedTime = Math.round(currentTime * 100) / 100
    const nextDuration = duration !== undefined ? Math.round(duration * 100) / 100 : this.state.duration
    if (this.state.currentTime === roundedTime && this.state.duration === nextDuration) {
      return
    }
    this.state = {
      currentTime: roundedTime,
      duration: nextDuration,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  public setCurrentTime = (currentTime: number): void => {
    const roundedTime = Math.round(currentTime * 100) / 100
    if (this.state.currentTime === roundedTime) return
    this.state = {
      ...this.state,
      currentTime: roundedTime,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  public setDuration = (duration: number): void => {
    const roundedDuration = Math.round(duration * 100) / 100
    if (this.state.duration === roundedDuration) return
    this.state = {
      ...this.state,
      duration: roundedDuration,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  public getCurrentTime = (): number => {
    return this.state.currentTime
  }

  public getDuration = (): number => {
    return this.state.duration
  }

  public reset = (): void => {
    if (this.state.currentTime === 0 && this.state.duration === 0) return
    this.state = { currentTime: 0, duration: 0 }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const playbackProgressStore = new PlaybackProgressStore()

export function usePlaybackProgressStore(): PlaybackProgressState {
  return useSyncExternalStore(
    playbackProgressStore.subscribe,
    playbackProgressStore.getSnapshot,
    () => ({ currentTime: 0, duration: 0 })
  )
}
