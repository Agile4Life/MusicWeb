export interface TiltRect {
  x: number
  y: number
  width: number
  height: number
}

export function calculateTilt(rect: TiltRect, maxTilt: number) {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(maxTilt)) {
    return { rotateX: 0, rotateY: 0 }
  }

  const centerX = rect.width / 2
  const centerY = rect.height / 2
  const pointerX = Math.min(rect.width, Math.max(0, rect.x))
  const pointerY = Math.min(rect.height, Math.max(0, rect.y))

  return {
    rotateX: Number((((pointerY - centerY) / centerY) * maxTilt).toFixed(2)),
    rotateY: Number((((centerX - pointerX) / centerX) * maxTilt).toFixed(2)),
  }
}
