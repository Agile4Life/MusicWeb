async function testCobalt() {
  const videoId = 'RKvRLLQtDbg'
  const instances = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh',
    'https://cobalt.api.scouts.cc'
  ]

  for (const base of instances) {
    try {
      console.log(`Testing Cobalt instance: ${base}...`)
      const res = await fetch(base, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          downloadMode: 'audio',
          audioFormat: 'mp3'
        })
      })
      if (res.ok) {
        const data = await res.json()
        console.log(`SUCCESS from ${base}:`, data)
        if (data.url) return data.url
      } else {
        console.log(`HTTP ${res.status} from ${base}`)
      }
    } catch (e) {
      console.log(`Failed ${base}:`, e.message)
    }
  }
}

testCobalt()
