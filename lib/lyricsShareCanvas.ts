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

  let baseSize = 68

  if (count === 1) {
    baseSize = maxLineLen > 40 ? 60 : 76
  } else if (count === 2) {
    baseSize = maxLineLen > 40 ? 54 : 66
  } else if (count === 3) {
    baseSize = maxLineLen > 45 ? 48 : 58
  } else if (count === 4) {
    baseSize = maxLineLen > 45 ? 44 : 52
  } else {
    baseSize = maxLineLen > 45 || totalChars > 160 ? 40 : 46
  }

  return Math.min(84, Math.max(38, baseSize))
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
export async function renderLyricCardToCanvas(
  options: GenerateCardOptions
): Promise<HTMLCanvasElement> {
  const width = 1080
  const height = 1920

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not supported')

  const theme = getThemeById(options.themeId)
  const lines = options.selectedLines.slice(0, 5) // max 5 lines

  // 1. Draw Multi-Layer Ambient Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height)
  bgGrad.addColorStop(0, theme.background[0])
  bgGrad.addColorStop(0.4, theme.background[1])
  bgGrad.addColorStop(1, theme.background[2])
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  // Radial ambient glow orbs
  const radialGlow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.28,
    50,
    width * 0.5,
    height * 0.28,
    width * 0.75
  )
  radialGlow.addColorStop(0, `${theme.accentColor}33`)
  radialGlow.addColorStop(0.6, `${theme.background[1]}22`)
  radialGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = radialGlow
  ctx.fillRect(0, 0, width, height)

  // 2. Load cover image & brand logo
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
    ctx.globalAlpha = 0.14
    ctx.filter = 'blur(60px)'
    ctx.drawImage(coverImg, -100, -100, width + 200, height * 0.5)
    ctx.restore()
  }

  // 3. Draw Header Brand Logo (/phong-signature.png)
  const headerY = 110
  ctx.save()
  if (logoImg && logoImg.width > 0 && logoImg.height > 0) {
    const logoHeight = 56
    const aspect = logoImg.width / logoImg.height
    const logoWidth = logoHeight * aspect
    ctx.filter = `invert(1) brightness(1.7) drop-shadow(0 0 14px ${theme.accentColor}99)`
    ctx.drawImage(logoImg, 90, headerY, logoWidth, logoHeight)
  } else {
    // Elegant fallback brand badge
    drawRoundedRect(ctx, 90, headerY, 210, 56, 28)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(122, headerY + 28, 8, 0, Math.PI * 2)
    ctx.fillStyle = theme.accentColor
    ctx.shadowColor = theme.accentColor
    ctx.shadowBlur = 12
    ctx.fill()

    ctx.shadowBlur = 0
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('MUSICWEB', 145, headerY + 36)
  }
  ctx.restore()

  // 4. Draw Track Metadata Card AT THE TOP (Header area)
  const metaCardX = 90
  const metaCardY = 195
  const metaCardWidth = 900
  const metaCardHeight = 175
  const metaCardRadius = 32

  ctx.save()
  // Glassmorphic top metadata backdrop
  drawRoundedRect(ctx, metaCardX, metaCardY, metaCardWidth, metaCardHeight, metaCardRadius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Draw Cover Art Thumbnail inside Top Metadata Card
  const coverThumbX = metaCardX + 22
  const coverThumbY = metaCardY + 22
  const coverThumbSize = 131
  const coverThumbRadius = 22

  ctx.save()
  drawRoundedRect(ctx, coverThumbX, coverThumbY, coverThumbSize, coverThumbSize, coverThumbRadius)
  ctx.clip()

  if (coverImg) {
    ctx.drawImage(coverImg, coverThumbX, coverThumbY, coverThumbSize, coverThumbSize)
  } else {
    // Fallback gradient cover
    const thumbGrad = ctx.createLinearGradient(
      coverThumbX,
      coverThumbY,
      coverThumbX + coverThumbSize,
      coverThumbY + coverThumbSize
    )
    thumbGrad.addColorStop(0, '#1e293b')
    thumbGrad.addColorStop(1, '#0f172a')
    ctx.fillStyle = thumbGrad
    ctx.fillRect(coverThumbX, coverThumbY, coverThumbSize, coverThumbSize)

    // Musical note icon
    ctx.fillStyle = theme.accentColor
    ctx.font = 'bold 46px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('♪', coverThumbX + coverThumbSize / 2, coverThumbY + coverThumbSize / 2)
  }
  ctx.restore()

  // Draw Track Title & Artist Text
  const textLeftX = coverThumbX + coverThumbSize + 28
  const maxTitleWidth = metaCardWidth - (coverThumbSize + 80)

  // Title (Bold & Prominent)
  ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#ffffff'
  let displayTitle = options.title || 'Bài hát chưa đặt tên'
  while (ctx.measureText(displayTitle).width > maxTitleWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -2) + '…'
  }
  ctx.fillText(displayTitle, textLeftX, metaCardY + 78)

  // Artist
  ctx.font = '600 28px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  let displayArtist = options.artist || 'Nghệ sĩ chưa xác định'
  while (ctx.measureText(displayArtist).width > maxTitleWidth && displayArtist.length > 3) {
    displayArtist = displayArtist.slice(0, -2) + '…'
  }
  ctx.fillText(displayArtist, textLeftX, metaCardY + 128)
  ctx.restore()

  // 5. Draw Selected Lyrics Body (Takes center stage from y:430 to y:1760)
  const fontSize = calculateOptimalFontSize(lines)
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = theme.textColor

  const maxTextWidth = 900
  const renderedLineList: string[] = []

  for (const rawLine of lines) {
    const wrapped = wrapCanvasText(ctx, rawLine, maxTextWidth)
    renderedLineList.push(...wrapped)
  }

  const lineHeight = fontSize * 1.5
  const totalBlockHeight = renderedLineList.length * lineHeight

  // Center the lyrics block vertically in available space (between y:420 and y:1760)
  const availableSpaceCenter = (420 + 1760) / 2
  let startY = availableSpaceCenter - totalBlockHeight / 2 + fontSize * 0.8
  if (startY < 450) startY = 450

  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 4

  for (let i = 0; i < renderedLineList.length; i++) {
    const lineText = renderedLineList[i]
    const curY = startY + i * lineHeight
    ctx.fillText(lineText, 90, curY)
  }
  ctx.restore()

  // 6. Subtle Bottom Brand Watermark
  const footerY = 1820
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Nghe trên MusicWeb', width / 2, footerY)
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
