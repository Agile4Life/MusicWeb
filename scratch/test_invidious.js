async function testInvidious() {
  const videoId = 'RKvRLLQtDbg'
  const instances = [
    'https://yewtu.be',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.drgns.space',
    'https://invidious.flokinet.to'
  ]

  for (const base of instances) {
    try {
      console.log(`Testing Invidious instance: ${base}...`)
      const res = await fetch(`${base}/api/v1/videos/${videoId}`)
      if (res.ok) {
        const data = await res.json()
        const adaptive = data.adaptiveFormats || []
        const audio = adaptive.find((a) => a.type?.startsWith('audio') || a.container === 'm4a' || a.mimeType?.includes('audio'))
        if (audio && audio.url) {
          console.log(`SUCCESS from ${base}:`, audio.url.slice(0, 120))
          return audio.url
        }
      }
    } catch (e) {
      console.log(`Failed ${base}:`, e.message)
    }
  }
}

testInvidious()
