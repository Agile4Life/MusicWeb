import { describe, expect, it } from 'vitest'

import {
  miniPlayerClassName,
  mobileContentPaddingClassName,
} from '../mobileLayout'

describe('mobile layout contract', () => {
  it('keeps the mini player above the bottom navigation and inside the viewport', () => {
    expect(miniPlayerClassName).toContain('lg:hidden')
    expect(miniPlayerClassName).toContain('overflow-hidden')
    expect(miniPlayerClassName).toContain('min-h-')
  })

  it('reserves content space for the mobile player stack', () => {
    expect(mobileContentPaddingClassName).toContain('mobile-player-stack-height')
    expect(mobileContentPaddingClassName).toContain('safe-area-inset-bottom')
  })
})
