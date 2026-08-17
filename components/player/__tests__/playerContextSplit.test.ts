import { describe, expect, it } from 'vitest'
import {
  usePlayer,
  usePlayerControls,
  usePlayerTrack,
  usePlayerQueue,
  usePlaybackProgress,
} from '../PlayerContext'

describe('Player Context Split and Granular Hooks', () => {
  it('exports all granular and unified player hooks', () => {
    expect(typeof usePlayer).toBe('function')
    expect(typeof usePlayerControls).toBe('function')
    expect(typeof usePlayerTrack).toBe('function')
    expect(typeof usePlayerQueue).toBe('function')
    expect(typeof usePlaybackProgress).toBe('function')
  })
})
