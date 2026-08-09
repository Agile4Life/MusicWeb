async function testPipedStream() {
  const videoId = 'RKvRLLQtDbg' // popular song ID
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://pipedapi.drgns.space',
    'https://piped-api.garudalinux.org',
    'https://piped-api.lunar.icu'
  ]

  for (const baseUrl of instances) {
    try {
      console.log(`Testing instance: ${baseUrl}...`)
      const res = await fetch(`${baseUrl}/streams/${videoId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.audioStreams && data.audioStreams.length > 0) {
          const audio = data.audioStreams.find((a) => a.mimeType?.includes('audio/mp4') || a.format === 'M4A') || data.audioStreams[0]
          console.log(`SUCCESS from ${baseUrl}:`, audio.url.slice(0, 100))
          return audio.url
        }
      }
    } catch (e) {
      console.log(`Failed ${baseUrl}:`, e.message)
    }
  }
}

testPipedStream().then(console.log)
