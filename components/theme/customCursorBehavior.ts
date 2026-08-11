import cursorAnimationData from '../../public/icons8-cursor.json'

export const CUSTOM_CURSOR_SIZE = 38
export const CUSTOM_CURSOR_HOTSPOT = 3

export type CursorAnimationOptions = {
  container: HTMLDivElement
  renderer: 'svg'
  loop: false
  autoplay: false
  animationData: typeof cursorAnimationData
  path?: never
}

export type RestartableCursorAnimation = {
  stop: () => void
  goToAndPlay: (value: number, isFrame?: boolean) => void
}

export function createCursorAnimationOptions(container: HTMLDivElement): CursorAnimationOptions {
  return {
    container,
    renderer: 'svg',
    loop: false,
    autoplay: false,
    animationData: cursorAnimationData,
  }
}

export function getCursorTransform(mouseX: number, mouseY: number) {
  return `translate(${mouseX - CUSTOM_CURSOR_HOTSPOT}px, ${mouseY - CUSTOM_CURSOR_HOTSPOT}px)`
}

export function restartCursorAnimation(animation: RestartableCursorAnimation) {
  animation.stop()
  animation.goToAndPlay(0, true)
}
