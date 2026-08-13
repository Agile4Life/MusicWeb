import { describe, expect, it } from 'vitest'

import {
  shouldCloseProfileMenu,
  shouldToggleProfileMenu,
} from '../profileMenuInteraction'

describe('profile menu interaction', () => {
  it('toggles from the current visibility state', () => {
    expect(shouldToggleProfileMenu(false)).toBe(true)
    expect(shouldToggleProfileMenu(true)).toBe(false)
  })

  it('closes only when a pointer target is outside menu and trigger', () => {
    const insideMenu = {}
    const insideTrigger = {}
    const outside = {}
    const menu = { contains: (target: EventTarget | null) => target === insideMenu } as unknown as Element
    const trigger = { contains: (target: EventTarget | null) => target === insideTrigger } as unknown as Element

    expect(shouldCloseProfileMenu(insideMenu as EventTarget, menu, trigger)).toBe(false)
    expect(shouldCloseProfileMenu(insideTrigger as EventTarget, menu, trigger)).toBe(false)
    expect(shouldCloseProfileMenu(outside as EventTarget, menu, trigger)).toBe(true)
  })
})
