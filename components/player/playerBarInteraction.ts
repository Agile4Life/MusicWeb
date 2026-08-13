interface ClosestTarget {
  closest?: (selector: string) => unknown
}

export function isPlayerBarFeatureTarget(target: ClosestTarget | null) {
  return Boolean(target?.closest?.('button,[data-playerbar-exclude-fullview]'))
}
