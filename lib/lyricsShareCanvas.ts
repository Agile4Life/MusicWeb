export type ThemeCategory = 'cover' | 'gradient' | 'solid' | 'minimal'

export interface LyricCardTheme {
  id: string
  name: string
  category: ThemeCategory
  background: string[]
  textColor: string
  accentColor: string
  solidColor?: string
}

export const LYRIC_CARD_THEMES: LyricCardTheme[] = [
  // 🖼️ 1. Nền Ảnh Bìa (Cover Image Backdrop)
  {
    id: 'cover',
    name: 'Ảnh bìa Album',
    category: 'cover',
    background: ['#0f172a', '#0b0f19', '#05070a'],
    textColor: '#ffffff',
    accentColor: '#38bdf8',
  },

  // 🎨 2. Gradient Đa Sắc (Color Gradients)
  {
    id: 'dominant',
    name: 'Xanh Cyan',
    category: 'gradient',
    background: ['#06b6d4', '#0e2338', '#07090e'],
    textColor: '#ffffff',
    accentColor: '#22d3ee',
  },
  {
    id: 'emerald',
    name: 'Xanh Emerald',
    category: 'gradient',
    background: ['#10b981', '#064e3b', '#051611'],
    textColor: '#ffffff',
    accentColor: '#34d399',
  },
  {
    id: 'sunset',
    name: 'Hoàng Hôn Sunset',
    category: 'gradient',
    background: ['#f59e0b', '#881337', '#180914'],
    textColor: '#ffffff',
    accentColor: '#fbbf24',
  },
  {
    id: 'cyberpunk',
    name: 'Hồng Cyberpunk',
    category: 'gradient',
    background: ['#ec4899', '#083344', '#090d16'],
    textColor: '#ffffff',
    accentColor: '#f472b6',
  },
  {
    id: 'midnight',
    name: 'Tím Midnight',
    category: 'gradient',
    background: ['#6366f1', '#1e1b4b', '#030712'],
    textColor: '#ffffff',
    accentColor: '#a5b4fc',
  },
  {
    id: 'ocean',
    name: 'Đại Dương Ocean',
    category: 'gradient',
    background: ['#0284c7', '#0f172a', '#020617'],
    textColor: '#ffffff',
    accentColor: '#38bdf8',
  },

  // ⚫ 3. Màu Đơn Sắc (Solid Colors)
  {
    id: 'solid-black',
    name: 'Đen tuyền (OLED Black)',
    category: 'solid',
    background: ['#09090b', '#09090b', '#09090b'],
    solidColor: '#09090b',
    textColor: '#ffffff',
    accentColor: '#e2e8f0',
  },
  {
    id: 'solid-red',
    name: 'Đỏ Ruby (Deep Red)',
    category: 'solid',
    background: ['#7f1d1d', '#500713', '#2a030a'],
    solidColor: '#450a0a',
    textColor: '#ffffff',
    accentColor: '#ef4444',
  },

  // ✨ 4. Minimal - Clean Flat Design
  {
    id: 'minimal-white',
    name: 'Trắng Tinh Tế',
    category: 'minimal',
    background: ['#f8fafc', '#f1f5f9', '#e2e8f0'],
    solidColor: '#ffffff',
    textColor: '#0f172a',
    accentColor: '#0f172a',
  },
  {
    id: 'minimal-black',
    name: 'Đen Tối Giản',
    category: 'minimal',
    background: ['#09090b', '#121215', '#18181b'],
    solidColor: '#121215',
    textColor: '#ffffff',
    accentColor: '#ffffff',
  },
  {
    id: 'minimal-cream',
    name: 'Kem Vintage',
    category: 'minimal',
    background: ['#faf6ee', '#f2ece0', '#e7dfd0'],
    solidColor: '#fcfaf6',
    textColor: '#292524',
    accentColor: '#44403c',
  },
]

export function getThemeById(themeId?: string): LyricCardTheme {
  const found = LYRIC_CARD_THEMES.find((t) => t.id === themeId)
  return found || LYRIC_CARD_THEMES.find((t) => t.id === 'dominant') || LYRIC_CARD_THEMES[0]
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
  album?: string | null
  coverUrl?: string | null
  selectedLines: string[]
  themeId?: string
  cardOnly?: boolean // When true: exports only the floating elevated card on a transparent background
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
 * Render Minimal Clean Card - Authentic flat card with left-aligned lyrics,
 * full album / track metadata row, and crisp high-contrast typography.
 */
export async function renderMinimalCardToCanvas(
  options: GenerateCardOptions
): Promise<HTMLCanvasElement> {
  const isCardOnly = Boolean(options.cardOnly)
  const theme = getThemeById(options.themeId)
  const lines = options.selectedLines.slice(0, 5)

  const fontSize = calculateOptimalFontSize(lines)
  const lineHeight = Math.round(fontSize * 1.55)

  // 1. Setup Card Dimensions
  const cardWidth = 920
  const cardRadius = 28
  const margin = 60 // Left and right inner padding

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (measureCtx) {
    measureCtx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  }

  const maxLyricWidth = cardWidth - margin * 2
  const renderedLineList: string[] = []

  for (const rawLine of lines) {
    if (measureCtx) {
      const wrapped = wrapCanvasText(measureCtx, rawLine, maxLyricWidth)
      renderedLineList.push(...wrapped)
    } else {
      renderedLineList.push(rawLine)
    }
  }

  // Calculate dynamic card dimensions
  const hasAlbum = Boolean(options.album && options.album.trim())
  const headerTopPadding = 50
  const coverSize = 114
  const headerBottomMargin = 32
  const headerTotalHeight = headerTopPadding + coverSize + headerBottomMargin

  const totalLyricsHeight = Math.max(1, renderedLineList.length) * lineHeight
  const cardBottomPadding = 65
  const cardHeight = Math.min(
    1380,
    Math.max(620, Math.round(headerTotalHeight + 40 + totalLyricsHeight + cardBottomPadding))
  )

  let width: number
  let height: number
  let cardX: number
  let cardY: number

  if (isCardOnly) {
    const shadowPadding = 45
    width = cardWidth + shadowPadding * 2
    height = cardHeight + shadowPadding * 2
    cardX = shadowPadding
    cardY = shadowPadding
  } else {
    width = 1080
    height = 1920
    cardX = (width - cardWidth) / 2
    cardY = Math.round((height - cardHeight) / 2)
  }

  const centerX = cardX + cardWidth / 2

  // 2. Initialize Canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not supported')

  // Load cover image
  let coverImg: HTMLImageElement | null = null
  if (options.coverUrl) {
    coverImg = await loadImageSafe(options.coverUrl)
  }

  const isLightTheme = theme.id === 'minimal-white' || theme.id === 'minimal-cream'

  // 3. Fill Story Background (Only when not in card-only mode)
  if (!isCardOnly) {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height)
    bgGrad.addColorStop(0, theme.background[0])
    bgGrad.addColorStop(0.5, theme.background[1])
    bgGrad.addColorStop(1, theme.background[2])
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, width, height)

    // Ambient radial glow
    const radialGlow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      60,
      width * 0.5,
      height * 0.5,
      width * 0.75
    )
    if (isLightTheme) {
      radialGlow.addColorStop(0, 'rgba(0, 0, 0, 0.03)')
      radialGlow.addColorStop(1, 'transparent')
    } else {
      radialGlow.addColorStop(0, 'rgba(255, 255, 255, 0.05)')
      radialGlow.addColorStop(1, 'transparent')
    }
    ctx.fillStyle = radialGlow
    ctx.fillRect(0, 0, width, height)
  }

  // 4. Simple flat card with subtle shadow
  ctx.save()
  ctx.shadowColor = isLightTheme
    ? 'rgba(0, 0, 0, 0.14)'
    : 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = isLightTheme ? 35 : 45
  ctx.shadowOffsetY = isLightTheme ? 14 : 18

  ctx.fillStyle = theme.solidColor || theme.background[0]
  drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius)
  ctx.fill()
  ctx.restore()

  // 5. Simple card border
  ctx.save()
  drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius)
  ctx.strokeStyle = isLightTheme
    ? 'rgba(0, 0, 0, 0.08)'
    : 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  // 6. Header Row: Cover Art + Track Metadata (Left-to-Right layout)
  const coverRadius = 16
  const coverX = cardX + margin
  const coverY = cardY + headerTopPadding

  // Cover shadow
  ctx.save()
  ctx.shadowColor = isLightTheme ? 'rgba(0, 0, 0, 0.16)' : 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.fillStyle = isLightTheme ? '#e2e8f0' : '#1e1e24'
  ctx.fill()
  ctx.restore()

  // Draw cover image (or stylized fallback)
  ctx.save()
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.clip()
  if (coverImg) {
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize)
  } else {
    ctx.fillStyle = isLightTheme ? '#e2e8f0' : '#27272a'
    ctx.fillRect(coverX, coverY, coverSize, coverSize)

    // Music note fallback
    ctx.fillStyle = isLightTheme ? '#94a3b8' : '#71717a'
    ctx.font = 'bold 44px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('♪', coverX + coverSize / 2, coverY + coverSize / 2)
  }
  ctx.restore()

  // Draw cover border
  ctx.save()
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius)
  ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  // 7. Header Track Metadata (Title, Artist, Album) - Left-Aligned next to Cover
  const textLeftX = coverX + coverSize + 24
  const maxHeaderWidth = cardWidth - margin - (textLeftX - cardX)

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // Track title
  ctx.font = 'bold 30px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = theme.textColor

  let displayTitle = options.title || 'Bài hát chưa đặt tên'
  while (ctx.measureText(displayTitle).width > maxHeaderWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -2) + '…'
  }
  const titleY = coverY + (hasAlbum ? 4 : 14)
  ctx.fillText(displayTitle, textLeftX, titleY)

  // Artist name
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = isLightTheme
    ? 'rgba(15, 23, 42, 0.70)'
    : 'rgba(255, 255, 255, 0.70)'

  let displayArtist = options.artist || 'Nghệ sĩ chưa xác định'
  while (ctx.measureText(displayArtist).width > maxHeaderWidth && displayArtist.length > 3) {
    displayArtist = displayArtist.slice(0, -2) + '…'
  }
  const artistY = titleY + 38
  ctx.fillText(displayArtist, textLeftX, artistY)

  // Album name (if available)
  if (hasAlbum && options.album) {
    ctx.font = '500 18px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = isLightTheme
      ? 'rgba(15, 23, 42, 0.50)'
      : 'rgba(255, 255, 255, 0.50)'

    let displayAlbum = `Album: ${options.album}`
    while (ctx.measureText(displayAlbum).width > maxHeaderWidth && displayAlbum.length > 3) {
      displayAlbum = displayAlbum.slice(0, -2) + '…'
    }
    const albumY = artistY + 30
    ctx.fillText(displayAlbum, textLeftX, albumY)
  }
  ctx.restore()

  // 8. Divider Line
  const dividerY = coverY + coverSize + headerBottomMargin
  ctx.save()
  ctx.strokeStyle = isLightTheme
    ? 'rgba(0, 0, 0, 0.08)'
    : 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cardX + margin, dividerY)
  ctx.lineTo(cardX + cardWidth - margin, dividerY)
  ctx.stroke()
  ctx.restore()

  // 9. 📜 Lyrics Text - CĂN TRÁI (LEFT-ALIGNED)
  const lyricsStartX = cardX + margin
  const lyricsStartY = dividerY + 38

  ctx.save()
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = theme.textColor
  ctx.textAlign = 'left' // Căn trái rõ ràng
  ctx.textBaseline = 'top'

  for (let i = 0; i < renderedLineList.length; i++) {
    const lineText = renderedLineList[i]
    const curY = lyricsStartY + i * lineHeight
    ctx.fillText(lineText, lyricsStartX, curY)
  }
  ctx.restore()

  // 10. Bottom Brand Watermark
  const footerY = cardY + cardHeight - 28
  ctx.save()
  ctx.fillStyle = isLightTheme
    ? 'rgba(15, 23, 42, 0.40)'
    : 'rgba(255, 255, 255, 0.40)'
  ctx.font = '600 18px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('phongtctmusic.vercel.app', centerX, footerY)
  ctx.restore()

  return canvas
}

/**
 * Render Full 9:16 Instagram Story Canvas (1080 x 1920)
 * - 100% Full-bleed ambient backdrop (fills Instagram Story screen seamlessly)
 * - Floating 3D Rounded Acrylic Card in the center with realistic elevation drop shadow
 * - Zero black corner triangles & Zero rectangular cropping
 */
export async function renderLyricCardToCanvas(
  options: GenerateCardOptions
): Promise<HTMLCanvasElement> {
  const theme = getThemeById(options.themeId)
  if (theme.category === 'minimal') {
    return renderMinimalCardToCanvas(options)
  }

  const isCardOnly = Boolean(options.cardOnly)
  const lines = options.selectedLines.slice(0, 5) // max 5 contiguous lines

  const fontSize = calculateOptimalFontSize(lines)
  const lineHeight = Math.round(fontSize * 1.55)

  // 1. Measure and wrap lyrics lines inside the 920px floating card
  const cardWidth = 920
  const cardRadius = 40

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (measureCtx) {
    measureCtx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  }

  const maxTextWidth = cardWidth - 120 // 60px padding on each side inside card
  const renderedLineList: string[] = []

  for (const rawLine of lines) {
    if (measureCtx) {
      const wrapped = wrapCanvasText(measureCtx, rawLine, maxTextWidth)
      renderedLineList.push(...wrapped)
    } else {
      renderedLineList.push(rawLine)
    }
  }

  // Calculate dynamic card height tailored to lyrics line count
  const cardHeaderHeight = 410
  const totalLyricsHeight = Math.max(1, renderedLineList.length) * lineHeight
  const cardBottomPadding = 80
  const cardHeight = Math.min(1380, Math.max(680, Math.round(cardHeaderHeight + totalLyricsHeight + cardBottomPadding)))

  let width: number
  let height: number
  let cardX: number
  let cardY: number

  if (isCardOnly) {
    // Compact canvas strictly bounding the floating card with shadow bleed padding
    const shadowPadding = 45
    width = cardWidth + shadowPadding * 2 // 1010px
    height = cardHeight + shadowPadding * 2
    cardX = shadowPadding
    cardY = shadowPadding
  } else {
    // Standard 9:16 Full-bleed Instagram Story resolution (1080 x 1920)
    width = 1080
    height = 1920
    cardX = (width - cardWidth) / 2 // 80px horizontal margin
    cardY = Math.round((height - cardHeight) / 2) // Perfect vertical center
  }

  const centerX = cardX + cardWidth / 2

  // 2. Initialize Canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not supported')

  // 3. 🖼️ Load cover image & brand logo
  let coverImg: HTMLImageElement | null = null
  let logoImg: HTMLImageElement | null = null

  const [loadedCover, loadedLogo] = await Promise.all([
    options.coverUrl ? loadImageSafe(options.coverUrl) : Promise.resolve(null),
    loadImageSafe('/phong-signature.png'),
  ])
  coverImg = loadedCover
  logoImg = loadedLogo

  // 4. 🎨 Render Full-Bleed 9:16 Story Ambient Background ONLY when not in cardOnly mode
  if (!isCardOnly) {
    if (theme.category === 'solid') {
      // ⚫ Solid Minimalist Background (Pure Black OLED or Ruby Red)
      ctx.fillStyle = theme.solidColor || theme.background[0]
      ctx.fillRect(0, 0, width, height)

      // Ambient radial glow in center
      const solidGlow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        50,
        width * 0.5,
        height * 0.5,
        width * 0.8
      )
      if (theme.id === 'solid-red') {
        solidGlow.addColorStop(0, 'rgba(239, 68, 68, 0.30)')
        solidGlow.addColorStop(1, 'transparent')
      } else {
        solidGlow.addColorStop(0, 'rgba(255, 255, 255, 0.04)')
        solidGlow.addColorStop(1, 'transparent')
      }
      ctx.fillStyle = solidGlow
      ctx.fillRect(0, 0, width, height)
    } else if (theme.category === 'cover') {
      // 🖼️ Full 9:16 Cover Artwork Backdrop (Rich blurred album art with dynamic contrast)
      ctx.fillStyle = '#06080d'
      ctx.fillRect(0, 0, width, height)

      if (coverImg) {
        ctx.save()
        ctx.globalAlpha = 0.55
        ctx.filter = 'blur(60px)'
        ctx.drawImage(coverImg, -100, -100, width + 200, height + 200)
        ctx.restore()

        // High-contrast readable scrim gradient overlay
        const scrim = ctx.createLinearGradient(0, 0, 0, height)
        scrim.addColorStop(0, 'rgba(0, 0, 0, 0.50)')
        scrim.addColorStop(0.5, 'rgba(0, 0, 0, 0.40)')
        scrim.addColorStop(1, 'rgba(0, 0, 0, 0.80)')
        ctx.fillStyle = scrim
        ctx.fillRect(0, 0, width, height)
      } else {
        const fallbackGrad = ctx.createLinearGradient(0, 0, width, height)
        fallbackGrad.addColorStop(0, '#1e293b')
        fallbackGrad.addColorStop(1, '#07090e')
        ctx.fillStyle = fallbackGrad
        ctx.fillRect(0, 0, width, height)
      }
    } else {
      // 🌈 Multi-layer Vibrant 9:16 Gradient
      const bgGrad = ctx.createLinearGradient(0, 0, width, height)
      bgGrad.addColorStop(0, theme.background[0])
      bgGrad.addColorStop(0.45, theme.background[1])
      bgGrad.addColorStop(1, theme.background[2])
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, width, height)

      if (coverImg) {
        ctx.save()
        ctx.globalAlpha = 0.32
        ctx.filter = 'blur(75px)'
        ctx.drawImage(coverImg, -120, -100, width + 240, height + 200)
        ctx.restore()
      }

      // Radial ambient glow orbs centered on the screen
      const radialGlow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.48,
        40,
        width * 0.5,
        height * 0.48,
        width * 0.85
      )
      radialGlow.addColorStop(0, `${theme.accentColor}40`)
      radialGlow.addColorStop(0.6, `${theme.background[1]}25`)
      radialGlow.addColorStop(1, 'transparent')
      ctx.fillStyle = radialGlow
      ctx.fillRect(0, 0, width, height)
    }
  }

  // 5. 🌟 Draw Floating 3D Elevated Rounded Card (Center of Canvas)
  // Drop Shadow for 3D Elevation
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
  ctx.shadowBlur = 55
  ctx.shadowOffsetY = 24
  ctx.fillStyle = theme.category === 'solid'
    ? (theme.id === 'solid-red' ? '#35060d' : '#08080a')
    : (isCardOnly ? 'rgba(10, 15, 26, 0.94)' : 'rgba(8, 12, 20, 0.76)')
  drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius)
  ctx.fill()
  ctx.restore()

  // Card Glass Surface (Clipped inside rounded card)
  ctx.save()
  drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius)
  ctx.clip()

  // Inner Glass Gradient Surface
  const cardSurfaceGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardHeight)
  if (theme.category === 'solid') {
    cardSurfaceGrad.addColorStop(0, theme.id === 'solid-red' ? '#4a0812' : '#0d0f17')
    cardSurfaceGrad.addColorStop(1, theme.id === 'solid-red' ? '#2b0409' : '#050608')
  } else if (theme.category === 'cover' && isCardOnly && coverImg) {
    // If card-only with album cover theme, draw soft blurred cover inside the card itself!
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.filter = 'blur(40px)'
    ctx.drawImage(coverImg, cardX - 50, cardY - 50, cardWidth + 100, cardHeight + 100)
    ctx.restore()
    cardSurfaceGrad.addColorStop(0, 'rgba(15, 23, 42, 0.75)')
    cardSurfaceGrad.addColorStop(1, 'rgba(5, 7, 10, 0.90)')
  } else {
    cardSurfaceGrad.addColorStop(0, 'rgba(255, 255, 255, 0.09)')
    cardSurfaceGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.02)')
    cardSurfaceGrad.addColorStop(1, 'rgba(0, 0, 0, 0.40)')
  }
  ctx.fillStyle = cardSurfaceGrad
  ctx.fillRect(cardX, cardY, cardWidth, cardHeight)

  // Card Top Specular Highlight
  const topShine = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 110)
  topShine.addColorStop(0, 'rgba(255, 255, 255, 0.16)')
  topShine.addColorStop(1, 'rgba(255, 255, 255, 0.0)')
  ctx.fillStyle = topShine
  ctx.fillRect(cardX, cardY, cardWidth, 110)

  // 6. 🌟 Draw Brand Logo Mini Glass Plaque inside Card
  const plaqueWidth = 280
  const plaqueHeight = 64
  const plaqueRadius = 18
  const plaqueX = cardX + (cardWidth - plaqueWidth) / 2
  const plaqueY = cardY + 42

  ctx.save()
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

  // Plaque Border with theme accent tone
  drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, plaqueRadius)
  ctx.strokeStyle = `${theme.accentColor}44`
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Draw Logo inside Plaque (100% white compositing)
  if (logoImg && logoImg.width > 0 && logoImg.height > 0) {
    const logoHeight = 40
    const aspect = logoImg.width / logoImg.height
    const logoWidth = Math.min(plaqueWidth - 40, logoHeight * aspect)
    const logoX = cardX + (cardWidth - logoWidth) / 2
    const logoY = plaqueY + (plaqueHeight - logoHeight) / 2

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

    ctx.save()
    ctx.shadowColor = theme.accentColor
    ctx.shadowBlur = 16
    ctx.drawImage(whiteCanvas, logoX, logoY)
    ctx.restore()

    ctx.save()
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
    ctx.shadowBlur = 5
    ctx.drawImage(whiteCanvas, logoX, logoY)
    ctx.restore()
  } else {
    ctx.font = 'bold 24px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('MUSICWEB', centerX, plaqueY + plaqueHeight / 2)
  }
  ctx.restore()

  // 7. 🎵 Draw Centered Track Metadata (Cover Art + Title + Artist)
  const coverSize = 135
  const coverRadius = 22
  const coverX = cardX + (cardWidth - coverSize) / 2
  const coverY = cardY + 130

  // Cover Shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
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
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(coverX, coverY, coverSize, coverSize)
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
  const maxTitleWidth = cardWidth - 100
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 36px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 14

  let displayTitle = options.title || 'Bài hát chưa đặt tên'
  while (ctx.measureText(displayTitle).width > maxTitleWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -2) + '…'
  }
  ctx.fillText(displayTitle, centerX, cardY + 295)

  // Centered Artist & Album
  let displayArtist = options.artist || 'Nghệ sĩ chưa xác định'
  if (options.album && options.album.trim() && options.album.trim() !== displayArtist && options.album.trim() !== displayTitle) {
    displayArtist = `${displayArtist} • ${options.album.trim()}`
  }
  while (ctx.measureText(displayArtist).width > maxTitleWidth && displayArtist.length > 3) {
    displayArtist = displayArtist.slice(0, -2) + '…'
  }
  ctx.fillText(displayArtist, centerX, cardY + 335)
  ctx.restore()

  // 8. 📜 Draw Lyrics: Centered Block with Left-Aligned Lines
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = theme.textColor

  const lineWidths = renderedLineList.map((l) => ctx.measureText(l).width)
  const startX = calculateLyricsBlockStartX(lineWidths, cardWidth, 50) + cardX
  const lyricsStartY = cardY + 395
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

  // 9. 🏷️ Bottom Brand Watermark inside Card
  const footerY = cardY + cardHeight - 32
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.font = '600 21px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('phongtctmusic.vercel.app', centerX, footerY)
  ctx.restore()

  // Unclip Card Surface
  ctx.restore()

  // 10. 🔲 Smooth Glass Border along Card Perimeter
  ctx.save()
  drawRoundedRect(ctx, cardX + 1.5, cardY + 1.5, cardWidth - 3, cardHeight - 3, cardRadius - 1)
  ctx.strokeStyle = `${theme.accentColor}75`
  ctx.lineWidth = 2.5
  ctx.stroke()

  drawRoundedRect(ctx, cardX + 3.5, cardY + 3.5, cardWidth - 7, cardHeight - 7, cardRadius - 3)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)'
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
