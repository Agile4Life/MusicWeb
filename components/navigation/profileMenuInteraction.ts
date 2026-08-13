export function shouldToggleProfileMenu(isOpen: boolean): boolean {
  return !isOpen
}

export function shouldCloseProfileMenu(
  target: EventTarget | null,
  menu: Element | null,
  trigger: Element | null,
): boolean {
  if (!target) return true

  const node = target as Node
  return !menu?.contains(node) && !trigger?.contains(node)
}
