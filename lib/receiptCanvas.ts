/**
 * Receipt Canvas Engine for MusicWeb Receiptify
 * Generates realistic vintage thermal paper music receipts
 */

export interface ReceiptTrackItem {
  id: string | number
  title: string
  artist?: string | null
  duration?: number | null // in seconds
}

export interface ReceiptTheme {
  id: string
  name: string
  paperBg: string
  paperGrad: [string, string]
  textColor: string
  subTextColor: string
  accentColor: string
  dividerColor: string
  barcodeColor: string
}

export const RECEIPT_THEMES: ReceiptTheme[] = [
  {
    id: 'classic',
    name: 'Giấy nhiệt cổ điển',
    paperBg: '#f6f5f0',
    paperGrad: ['#fcfbf8', '#eeebe2'],
    textColor: '#18181b',
    subTextColor: '#52525b',
    accentColor: '#0891b2',
    dividerColor: 'rgba(24, 24, 27, 0.45)',
    barcodeColor: '#18181b',
  },
  {
    id: 'midnight',
    name: 'Hóa đơn đêm Neon',
    paperBg: '#090d18',
    paperGrad: ['#0f172a', '#060911'],
    textColor: '#f8fafc',
    subTextColor: '#94a3b8',
    accentColor: '#22d3ee',
    dividerColor: 'rgba(255, 255, 255, 0.28)',
    barcodeColor: '#ffffff',
  },
  {
    id: 'cafe',
    name: 'Vintage Cafe Kraft',
    paperBg: '#e8dcc6',
    paperGrad: ['#f0e6d2', '#ded0b6'],
    textColor: '#2d1f14',
    subTextColor: '#664d38',
    accentColor: '#d97706',
    dividerColor: 'rgba(45, 31, 20, 0.4)',
    barcodeColor: '#2d1f14',
  },
]

export function getReceiptThemeById(themeId?: string): ReceiptTheme {
  const found = RECEIPT_THEMES.find((t) => t.id === themeId)
  return found || RECEIPT_THEMES[0]
}

export interface GenerateReceiptOptions {
  title?: string
  periodLabel?: string
  userName?: string
  tracks: ReceiptTrackItem[]
  themeId?: string
  orderNumber?: string | number
  date?: Date
}

/**
 * Format duration in seconds to mm:ss format
 */
export function formatReceiptDuration(seconds?: number | null): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '03:20'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * Format total duration in seconds to hh:mm:ss or mm:ss
 */
export function formatTotalDuration(tracks: ReceiptTrackItem[]): string {
  const totalSeconds = tracks.reduce((acc, t) => acc + (t.duration && t.duration > 0 ? t.duration : 200), 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Draw jagged ripped zigzag top or bottom edge of receipt paper
 */
function drawRippedEdge(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  teethCount: number = 28,
  teethDepth: number = 8,
  isTop: boolean = true
) {
  const step = width / teethCount
  ctx.beginPath()
  if (isTop) {
    ctx.moveTo(0, y)
    for (let i = 0; i < teethCount; i++) {
      const midX = i * step + step / 2
      const endX = (i + 1) * step
      ctx.lineTo(midX, y + teethDepth)
      ctx.lineTo(endX, y)
    }
  } else {
    ctx.moveTo(0, y)
    for (let i = 0; i < teethCount; i++) {
      const midX = i * step + step / 2
      const endX = (i + 1) * step
      ctx.lineTo(midX, y - teethDepth)
      ctx.lineTo(endX, y)
    }
  }
}

/**
 * Draw procedural barcode
 */
function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) {
  const barPattern = [
    2, 1, 3, 1, 1, 2, 4, 1, 2, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2, 1, 1, 3, 2, 4, 1, 2,
    1, 3, 2, 1, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 3, 1, 2, 1, 2, 3, 1, 4, 1, 2, 3,
    1, 2, 1, 4, 2, 1, 3, 1, 2, 1, 1, 3, 2, 4, 1, 2, 1, 3, 2, 1, 4, 1, 2, 1, 3,
  ]

  const totalUnits = barPattern.reduce((a, b) => a + b, 0)
  const unitWidth = width / totalUnits

  ctx.fillStyle = color
  let currentX = x
  let isBar = true

  for (const barWidth of barPattern) {
    const w = barWidth * unitWidth
    if (isBar) {
      ctx.fillRect(currentX, y, Math.max(1, w - 0.5), height)
    }
    currentX += w
    isBar = !isBar
  }
}

/**
 * Truncate text with ellipsis if too long
 */
function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let result = text
  while (ctx.measureText(result + '…').width > maxWidth && result.length > 2) {
    result = result.slice(0, -1)
  }
  return result + '…'
}

/**
 * Calculate total dynamic height of thermal receipt
 */
export function calculateReceiptHeight(trackCount: number): number {
  const headerHeight = 310
  const rowHeight = 44
  const tracksHeight = Math.max(1, trackCount) * rowHeight
  const summaryHeight = 110
  const paymentInfoHeight = 140
  const footerHeight = 220
  const padding = 60

  return Math.round(headerHeight + tracksHeight + summaryHeight + paymentInfoHeight + footerHeight + padding)
}

/**
 * Render complete Receipt to HTML5 Canvas
 */
export async function renderReceiptToCanvas(
  options: GenerateReceiptOptions
): Promise<HTMLCanvasElement> {
  const width = 760
  const tracks = options.tracks.slice(0, 50)
  const theme = getReceiptThemeById(options.themeId)
  const height = calculateReceiptHeight(tracks.length)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not supported')

  // 1. Draw Paper Background with subtle thermal gradient
  const paperGrad = ctx.createLinearGradient(0, 0, 0, height)
  paperGrad.addColorStop(0, theme.paperGrad[0])
  paperGrad.addColorStop(1, theme.paperGrad[1])
  ctx.fillStyle = paperGrad
  ctx.fillRect(0, 0, width, height)

  // Paper edge shadow / vignette
  ctx.fillStyle = 'rgba(0, 0, 0, 0.03)'
  ctx.fillRect(0, 0, 14, height)
  ctx.fillRect(width - 14, 0, 14, height)

  // Top & Bottom Zigzag Paper Rips
  ctx.fillStyle = theme.id === 'midnight' ? '#07090e' : '#1e293b'
  drawRippedEdge(ctx, width, 0, 30, 9, true)
  ctx.fill()
  drawRippedEdge(ctx, width, height, 30, 9, false)
  ctx.fill()

  const date = options.date || new Date()
  const dateStr = date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const timeStr = date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const orderNum = options.orderNumber || Math.floor(1000 + Math.random() * 9000)
  const customerName = (options.userName || 'CUSTOMER').toUpperCase()

  // Typography Constants
  const monoFontBold = 'bold 22px "Courier New", Courier, monospace, monospace'
  const monoFontHeader = '900 36px "Courier New", Courier, monospace, monospace'
  const monoFontRegular = '600 18px "Courier New", Courier, monospace, monospace'
  const monoFontSmall = '600 15px "Courier New", Courier, monospace, monospace'

  const drawDivider = (yPos: number) => {
    ctx.save()
    ctx.strokeStyle = theme.dividerColor
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(36, yPos)
    ctx.lineTo(width - 36, yPos)
    ctx.stroke()
    ctx.restore()
  }

  let y = 45

  // 2. 🏪 Store Header
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = theme.textColor

  // Main Store Logo Title
  ctx.font = monoFontHeader
  ctx.fillText(options.title || 'MUSICWEB STORE', width / 2, y)
  y += 34

  // Period / Metric Subtitle
  ctx.font = monoFontBold
  ctx.fillStyle = theme.accentColor
  ctx.fillText(`*** ${options.periodLabel || 'NOW PLAYING RECEIPT'} ***`, width / 2, y)
  y += 32

  // Order Details
  ctx.font = monoFontSmall
  ctx.fillStyle = theme.subTextColor
  ctx.fillText(`ORDER #000${orderNum}   FOR ${customerName}`, width / 2, y)
  y += 24
  ctx.fillText(`${dateStr}  ${timeStr}`, width / 2, y)
  y += 30
  ctx.restore()

  drawDivider(y)
  y += 26

  // 3. 📋 Itemized Column Header
  ctx.save()
  ctx.font = monoFontBold
  ctx.fillStyle = theme.textColor

  ctx.textAlign = 'left'
  ctx.fillText('QTY', 40, y)
  ctx.fillText('ITEM', 105, y)

  ctx.textAlign = 'right'
  ctx.fillText('AMT', width - 40, y)
  ctx.restore()

  y += 14
  drawDivider(y)
  y += 26

  // 4. 🎵 Track List Items
  ctx.save()
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    const qtyStr = (i + 1).toString().padStart(2, '0')
    const trackDuration = formatReceiptDuration(track.duration)

    // QTY
    ctx.font = monoFontBold
    ctx.fillStyle = theme.subTextColor
    ctx.textAlign = 'left'
    ctx.fillText(qtyStr, 40, y)

    // ITEM (Title + Artist)
    const rawTitle = (track.title || 'Unknown Track').toUpperCase()
    const rawArtist = (track.artist || 'Unknown Artist').toUpperCase()
    const itemFullText = `${rawTitle} - ${rawArtist}`

    ctx.font = monoFontBold
    ctx.fillStyle = theme.textColor
    const maxItemWidth = width - 230 // leave space for QTY and AMT
    const truncatedItem = truncateText(ctx, itemFullText, maxItemWidth)
    ctx.fillText(truncatedItem, 105, y)

    // AMT (Duration)
    ctx.font = monoFontBold
    ctx.fillStyle = theme.textColor
    ctx.textAlign = 'right'
    ctx.fillText(trackDuration, width - 40, y)

    y += 42
  }
  ctx.restore()

  y += 6
  drawDivider(y)
  y += 28

  // 5. 📊 Totals Summary
  ctx.save()
  ctx.font = monoFontBold
  ctx.fillStyle = theme.textColor

  // Item count
  ctx.textAlign = 'left'
  ctx.fillText('ITEM COUNT:', 40, y)
  ctx.textAlign = 'right'
  ctx.fillText(tracks.length.toString(), width - 40, y)
  y += 32

  // Total time
  ctx.textAlign = 'left'
  ctx.fillText('TOTAL TIME:', 40, y)
  ctx.textAlign = 'right'
  ctx.fillText(formatTotalDuration(tracks), width - 40, y)
  y += 22
  ctx.restore()

  drawDivider(y)
  y += 28

  // 6. 💳 Payment & Authentication Details
  ctx.save()
  ctx.font = monoFontSmall
  ctx.fillStyle = theme.subTextColor
  ctx.textAlign = 'left'

  ctx.fillText('CARD #:  **** **** **** 2026', 40, y)
  y += 24
  ctx.fillText(`AUTH CODE:  ${Math.floor(100000 + Math.random() * 900000)}`, 40, y)
  y += 24
  ctx.fillText(`CARDHOLDER: ${customerName}`, 40, y)
  y += 24
  ctx.restore()

  drawDivider(y)
  y += 30

  // 7. 🎁 Thank You & Barcode Section
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = theme.textColor

  ctx.font = monoFontBold
  ctx.fillText('THANK YOU FOR LISTENING!', width / 2, y)
  y += 24

  // Draw procedural barcode
  const barcodeWidth = width - 160
  const barcodeHeight = 58
  const barcodeX = (width - barcodeWidth) / 2
  drawBarcode(ctx, barcodeX, y, barcodeWidth, barcodeHeight, theme.barcodeColor)
  y += barcodeHeight + 20

  // Website & Signature URL
  ctx.font = monoFontRegular
  ctx.fillStyle = theme.subTextColor
  ctx.fillText('phongtctmusic.vercel.app', width / 2, y)
  ctx.restore()

  return canvas
}

/**
 * Generate Receipt Image Blob
 */
export async function generateReceiptBlob(
  options: GenerateReceiptOptions
): Promise<Blob> {
  const canvas = await renderReceiptToCanvas(options)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to generate receipt image blob'))
      },
      'image/png',
      1.0
    )
  })
}

/**
 * Generate Receipt Data URL
 */
export async function generateReceiptDataUrl(
  options: GenerateReceiptOptions
): Promise<string> {
  const canvas = await renderReceiptToCanvas(options)
  return canvas.toDataURL('image/png', 1.0)
}
