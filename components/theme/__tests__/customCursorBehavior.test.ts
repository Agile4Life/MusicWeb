import { describe, expect, test } from 'vitest'

import {
  CUSTOM_CURSOR_HOTSPOT,
  CUSTOM_CURSOR_SIZE,
  createCursorAnimationOptions,
  getCursorTransform,
  restartCursorAnimation,
} from '../customCursorBehavior'

describe('custom cursor behavior', () => {
  test('restarts the click animation from frame zero for every rapid click', () => {
    const calls: string[] = []
    const animation = {
      stop: () => {
        calls.push('stop')
      },
      goToAndPlay: (frame: number, isFrame?: boolean) => {
        calls.push(`play:${frame}:${isFrame}`)
      },
    }

    restartCursorAnimation(animation)
    restartCursorAnimation(animation)

    expect(calls).toEqual([
      'stop',
      'play:0:true',
      'stop',
      'play:0:true',
    ])
  })

  test('keeps the smaller cursor aligned by its visible hotspot', () => {
    expect(CUSTOM_CURSOR_SIZE).toBe(38)
    expect(CUSTOM_CURSOR_HOTSPOT).toBe(3)
    expect(getCursorTransform(120, 80)).toBe('translate(117px, 77px)')
  })

  test('loads cursor animation from bundled data instead of Lottie XHR', () => {
    const container = {} as HTMLDivElement

    const options = createCursorAnimationOptions(container)

    expect(options.container).toBe(container)
    expect(options.path).toBeUndefined()
    expect(options.animationData).toBeTruthy()
    expect(options.renderer).toBe('svg')
    expect(options.loop).toBe(false)
    expect(options.autoplay).toBe(false)
  })
})
