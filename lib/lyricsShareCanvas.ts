export interface LyricCardTheme {
  id: string
  name: string
  background: string[]
  textColor: string
  accentColor: string
}

export const LYRIC_CARD_THEMES: LyricCardTheme[] = [
  {
    id: 'dominant',
    name: 'Dominant Glow',
    background: ['#06b6d4', '#0e2338', '#07090e'],
    textColor: '#ffffff',
    accentColor: '#22d3ee',
  },
  {
    id: 'midnight',
    name: 'Midnight Obsidian',
    background: ['#6366f1', '#1e1b4b', '#030712'],
    textColor: '#ffffff',
    accentColor: '#a5b4fc',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    background: ['#ec4899', '#083344', '#090d16'],
    textColor: '#ffffff',
    accentColor: '#f472b6',
  },
  {
    id: 'sunset',
    name: 'Sunset Horizon',
    background: ['#f59e0b', '#881337', '#180914'],
    textColor: '#ffffff',
    accentColor: '#fbbf24',
  },
  {
    id: 'emerald',
    name: 'Emerald Beats',
    background: ['#10b981', '#064e3b', '#051611'],
    textColor: '#ffffff',
    accentColor: '#34d399',
  },
]

export function getThemeById(themeId?: string): LyricCardTheme {
  const found = LYRIC_CARD_THEMES.find((t) => t.id === themeId)
  return found || LYRIC_CARD_THEMES[0]
}

/**
 * Toggle or extend contiguous selection range (1 to 5 consecutive lines).
 * Enforces Spotify/Apple Music style contiguous lyric selection.
 */
export function toggleContiguousLyricLine(
  currentIndices: number[],
  clickedIndex: number,
  maxCount: number = 5
): { nextIndices: number[]; reason?: 'min_required' | 'max_reached' | 'reset' } {
  if (currentIndices.length === 0) {
    return { nextIndices: [clickedIndex] }
  }

  const sorted = [...currentIndices].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  // Case 1: Clicking an already selected line
  if (sorted.includes(clickedIndex)) {
    if (sorted.length === 1) {
      // Trying to unselect the only line
      return { nextIndices: sorted, reason: 'min_required' }
    }
    // If clicking the top edge (min), shrink by removing min
    if (clickedIndex === min) {
      return { nextIndices: sorted.slice(1) }
    }
    // If clicking the bottom edge (max), shrink by removing max
    if (clickedIndex === max) {
      return { nextIndices: sorted.slice(0, -1) }
    }
    // If clicking in the middle: shrink range to [min, clickedIndex]
    const subRange: number[] = []
    for (let i = min; i <= clickedIndex; i++) {
      subRange.push(i)
    }
    return { nextIndices: subRange }
  }

  // Case 2: Clicking an unselected line
  // Check if we can form a contiguous range from min to clickedIndex (or clickedIndex to max)
  const newMin = Math.min(min, clickedIndex)
  const newMax = Math.max(max, clickedIndex)
  const proposedCount = newMax - newMin + 1

  if (proposedCount <= maxCount) {
    // Fill all integers between newMin and newMax to guarantee contiguity
    const range: number[] = []
    for (let i = newMin; i <= newMax; i++) {
      range.push(i)
    }
    return { nextIndices: range }
  }

  // If distance exceeds maxCount (clicked line is far away, > 5 lines apart):
  // Start a fresh contiguous selection at the clicked line
  return { nextIndices: [clickedIndex], reason: 'reset' }
}

export interface GenerateCardOptions {
  title: string
  artist?: string | null
  coverUrl?: string | null
  selectedLines: string[]
  themeId?: string
}

/**
 * Break a long string into wrapped lines if it exceeds maxWidth
 */
export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ')
  if (words.length <= 1) return [text]

  const lines: string[] = []
  let currentLine = words[0]

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const testLine = `${currentLine} ${word}`
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  lines.push(currentLine)
  return lines
}

/**
 * Calculate dynamic font size based on total line count and character length
 */
export function calculateOptimalFontSize(lines: string[]): number {
  const count = Math.max(1, lines.length)
  const maxLineLen = Math.max(...lines.map((l) => l.length), 0)
  const totalChars = lines.reduce((acc, l) => acc + l.length, 0)

  let baseSize = 78

  if (count === 1) {
    baseSize = maxLineLen > 40 ? 76 : 92
  } else if (count === 2) {
    baseSize = maxLineLen > 40 ? 68 : 82
  } else if (count === 3) {
    baseSize = maxLineLen > 45 ? 60 : 72
  } else if (count === 4) {
    baseSize = maxLineLen > 45 ? 54 : 64
  } else {
    baseSize = maxLineLen > 45 || totalChars > 160 ? 48 : 56
  }

  return Math.min(98, Math.max(46, baseSize))
}

/**
 * Helper to draw rounded rectangle
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * Load image safely with crossOrigin
 */
function loadImageSafe(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Render complete 9:16 high-res Story card to HTML5 Canvas (1080 x 1920)
 */
/**
 * Helper to calculate lyrics block width and startX for block-centered left-aligned text
 */
export function calculateLyricsBlockStartX(
  lineWidths: number[],
  canvasWidth: number = 1080,
  minMargin: number = 110
): number {
  if (lineWidths.length === 0) return minMargin
  const maxLineWidth = Math.max(...lineWidths, 0)
  const centeredLeft = Math.round((canvasWidth - maxLineWidth) / 2)
  return Math.max(minMargin, centeredLeft)
}

/**
 * Helper to calculate compact canvas height based on rendered line count and font size
 */
export function calculateCompactCardHeight(
  renderedLineCount: number,
  fontSize: number,
  lyricsStartY: number = 460,
  bottomPadding: number = 100
): number {
  const lineHeight = Math.round(fontSize * 1.55)
  const totalLyricsHeight = Math.max(1, renderedLineCount) * lineHeight
  return Math.round(lyricsStartY + totalLyricsHeight + bottomPadding)
}

/**
 * Render compact high-res Story-width card to HTML5 Canvas (1080 x Dynamic Compact Height)
 * - Gentle smooth rounded corners (border radius)
 * - Sleek glassmorphic accent border
 * - Rich ambient album artwork glow
 */
export async function renderLyricCardToCanvas(
  options: GenerateCardOptions
): Promise<HTMLCanvasElement> {
  const width = 1080
  const theme = getThemeById(options.themeId)
  const lines = options.selectedLines.slice(0, 5) // max 5 contiguous lines

  const fontSize = calculateOptimalFontSize(lines)
  const lineHeight = Math.round(fontSize * 1.55)

  // 1. Measure and wrap lyrics lines first to calculate exact tailored height
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (measureCtx) {
    measureCtx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  }

  const maxTextWidth = 860 // 110px safe horizontal margins on 1080px width
  const renderedLineList: string[] = []

  for (const rawLine of lines) {
    if (measureCtx) {
      const wrapped = wrapCanvasText(measureCtx, rawLine, maxTextWidth)
      renderedLineList.push(...wrapped)
    } else {
      renderedLineList.push(rawLine)
    }
  }

  const lyricsStartY = 460
  const height = calculateCompactCardHeight(
    renderedLineList.length,
    fontSize,
    lyricsStartY,
    110
  )

  // 2. Initialize Canvas with 1080 width and perfectly fitted compact height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not supported')

  // 3. Draw Multi-Layer Ambient Background (Full-bleed edge-to-edge, NO transparent corners)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height)
  bgGrad.addColorStop(0, theme.background[0])
  bgGrad.addColorStop(0.45, theme.background[1])
  bgGrad.addColorStop(1, theme.background[2])
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  // 5. Load cover image & brand logo
  let coverImg: HTMLImageElement | null = null
  let logoImg: HTMLImageElement | null = null

  const [loadedCover, loadedLogo] = await Promise.all([
    options.coverUrl ? loadImageSafe(options.coverUrl) : Promise.resolve(null),
    loadImageSafe('/phong-signature.png'),
  ])
  coverImg = loadedCover
  logoImg = loadedLogo

  if (coverImg) {
    ctx.save()
    ctx.globalAlpha = 0.32
    ctx.filter = 'blur(60px)'
    ctx.drawImage(coverImg, -120, -100, width + 240, height + 200)
    ctx.restore()
  }

  // Radial ambient glow orbs centered on the card for rich, luminous lighting
  const radialGlow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.32,
    30,
    width * 0.5,
    height * 0.32,
    width * 0.75
  )
  radialGlow.addColorStop(0, `${theme.accentColor}44`)
  radialGlow.addColorStop(0.55, `${theme.background[1]}30`)
  radialGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = radialGlow
  ctx.fillRect(0, 0, width, height)

  // Secondary soft glow at bottom right
  const secondaryGlow = ctx.createRadialGradient(
    width * 0.8,
    height * 0.75,
    20,
    width * 0.8,
    height * 0.75,
    width * 0.55
  )
  secondaryGlow.addColorStop(0, `${theme.accentColor}25`)
  secondaryGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = secondaryGlow
  ctx.fillRect(0, 0, width, height)

  // Top subtle specular lighting
  const topShine = ctx.createLinearGradient(0, 0, 0, 100)
  topShine.addColorStop(0, 'rgba(255, 255, 255, 0.14)')
  topShine.addColorStop(1, 'rgba(255, 255, 255, 0.0)')
  ctx.fillStyle = topShine
  ctx.fillRect(0, 0, width, 100)

  // 6. 🌟 Draw Brand Logo Mini Glass Plaque (Matching web header style)
  const plaqueWidth = 320
  const plaqueHeight = 72
  const plaqueRadius = 22
  const plaqueX = (width - plaqueWidth) / 2
  const plaqueY = 65

  ctx.save()
  // Outer Plaque Backdrop
  drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, plaqueRadius)
  const plaqueBgGrad = ctx.createLinearGradient(
    plaqueX,
    plaqueY,
    plaqueX + plaqueWidth,
    plaqueY + plaqueHeight
  )
  plaqueBgGrad.addColorStop(0, 'rgba(24, 30, 44, 0.85)')
  plaqueBgGrad.addColorStop(1, 'rgba(10, 14, 22, 0.92)')
  ctx.fillStyle = plaqueBgGrad
  ctx.fill()

  // Inner subtle top shine
  const shineGrad = ctx.createLinearGradient(plaqueX, plaqueY, plaqueX, plaqueY + 32)
  shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
  shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)')
  drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, 32, plaqueRadius)
  ctx.fillStyle = shineGrad
  ctx.fill()

  // Plaque Border with theme accent tone
  drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, plaqueRadius)
  ctx.strokeStyle = `${theme.accentColor}44`
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Secondary soft white outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Draw Logo inside Plaque (100% white compositing)
  if (logoImg && logoImg.width > 0 && logoImg.height > 0) {
    const logoHeight = 48
    const aspect = logoImg.width / logoImg.height
    const logoWidth = Math.min(plaqueWidth - 40, logoHeight * aspect)
    const logoX = (width - logoWidth) / 2
    const logoY = plaqueY + (plaqueHeight - logoHeight) / 2

    // Create 100% reliable pure white tinted image canvas
    const whiteCanvas = document.createElement('canvas')
    whiteCanvas.width = Math.round(logoWidth)
    whiteCanvas.height = Math.round(logoHeight)
    const whiteCtx = whiteCanvas.getContext('2d')
    if (whiteCtx) {
      whiteCtx.drawImage(logoImg, 0, 0, whiteCanvas.width, whiteCanvas.height)
      whiteCtx.globalCompositeOperation = 'source-in'
      whiteCtx.fillStyle = '#ffffff'
      whiteCtx.fillRect(0, 0, whiteCanvas.width, whiteCanvas.height)
    }

    // Pass 1: Luminous theme neon glow
    ctx.save()
    ctx.shadowColor = theme.accentColor
    ctx.shadowBlur = 18
    ctx.drawImage(whiteCanvas, logoX, logoY)
    ctx.restore()

    // Pass 2: High-contrast pure white crisp signature
    ctx.save()
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
    ctx.shadowBlur = 6
    ctx.drawImage(whiteCanvas, logoX, logoY)
    ctx.restore()
  } else {
    // Elegant fallback brand text
    ctx.font = 'bold 26px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = theme.accentColor
    ctx.shadowBlur = 12
    ctx.fillText('MUSICWEB', width / 2, plaqueY + plaqueHeight / 2)
  }
  ctx.restore()

  // 6. 🎵 Draw Centered Track Metadata (Cover Art + Title + Artist)
  const coverSize = 145
  const coverRadius = 24
  const coverX = (width - coverSize) / 2
  const coverY = 168

  ctx.save()
  // Cover Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 10

  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  ctx.restore()

  // Draw Cover Image
  ctx.save()
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.clip()

  if (coverImg) {
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize)
  } else {
    const thumbGrad = ctx.createLinearGradient(
      coverX,
      coverY,
      coverX + coverSize,
      coverY + coverSize
    )
    thumbGrad.addColorStop(0, '#1e293b')
    thumbGrad.addColorStop(1, '#0f172a')
    ctx.fillStyle = thumbGrad
    ctx.fillRect(coverX, coverY, coverSize, coverSize)

    ctx.fillStyle = theme.accentColor
    ctx.font = 'bold 50px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('♪', coverX + coverSize / 2, coverY + coverSize / 2)
  }
  ctx.restore()

  // Cover Border
  ctx.save()
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  // Centered Track Title
  const maxTitleWidth = 880
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 40px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 14

  let displayTitle = options.title || 'Bài hát chưa đặt tên'
  while (ctx.measureText(displayTitle).width > maxTitleWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -2) + '…'
  }
  ctx.fillText(displayTitle, width / 2, 352)

  // Centered Artist
  ctx.font = '600 27px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  let displayArtist = options.artist || 'Nghệ sĩ chưa xác định'
  while (ctx.measureText(displayArtist).width > maxTitleWidth && displayArtist.length > 3) {
    displayArtist = displayArtist.slice(0, -2) + '…'
  }
  ctx.fillText(displayArtist, width / 2, 394)
  ctx.restore()

  // 7. 📜 Draw Lyrics: Centered Block with Left-Aligned Lines
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = theme.textColor

  // Measure all rendered line widths
  const lineWidths = renderedLineList.map((l) => ctx.measureText(l).width)
  const startX = calculateLyricsBlockStartX(lineWidths, width, 110)
  const startY = lyricsStartY + fontSize * 0.85

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 4

  for (let i = 0; i < renderedLineList.length; i++) {
    const lineText = renderedLineList[i]
    const curY = startY + i * lineHeight
    ctx.fillText(lineText, startX, curY)
  }
  ctx.restore()

  // 8. 🏷️ Subtle Bottom Brand Watermark
  const footerY = height - 42
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.font = '600 23px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Nghe trên MusicWeb', width / 2, footerY)
  ctx.restore()

  // 9. 🔲 Sleek Gentle Rounded Border (Clean rounded frame with continuous filled background)
  const borderInset = 18
  const cardRadius = 32
  ctx.save()
  drawRoundedRect(ctx, borderInset, borderInset, width - borderInset * 2, height - borderInset * 2, cardRadius)
  ctx.strokeStyle = `${theme.accentColor}55`
  ctx.lineWidth = 2.5
  ctx.stroke()

  drawRoundedRect(ctx, borderInset + 1.5, borderInset + 1.5, width - (borderInset + 1.5) * 2, height - (borderInset + 1.5) * 2, cardRadius - 1.5)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()

  return canvas
}

/**
 * Generate high-res PNG Blob for Web Share API or download
 */
export async function generateLyricCardBlob(
  options: GenerateCardOptions
): Promise<Blob> {
  const canvas = await renderLyricCardToCanvas(options)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to generate image blob from canvas'))
      },
      'image/png',
      1.0
    )
  })
}

/**
 * Generate PNG Data URL for live preview
 */
export async function generateLyricCardDataUrl(
  options: GenerateCardOptions
): Promise<string> {
  const canvas = await renderLyricCardToCanvas(options)
  return canvas.toDataURL('image/png', 1.0)
}
