const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('.env.local not found')
  process.exit(1)
}

const envContent = fs.readFileSync(envPath, 'utf8')
const envVars = {}
envContent.split('\n').forEach((line) => {
  const parts = line.split('=')
  if (parts.length >= 2) {
    const k = parts[0].trim()
    const v = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '')
    envVars[k] = v
  }
})

const url = envVars.NEXT_PUBLIC_SUPABASE_URL
const key = envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Supabase URL or Key missing')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('Cleaning mismatched tracks in Supabase DB...')
  
  // 1. Clear any tracks where album is 'My Spot' but artist is NOT Doc Becketts
  const { data: clearedMySpot, error: err1 } = await supabase
    .from('tracks')
    .update({ spotify_album_id: null, album: null })
    .ilike('album', '%My Spot%')
    .not('artist', 'ilike', '%Doc Becketts%')
    .select('id, title, artist, album')

  console.log('Cleared mismatched My Spot tracks:', clearedMySpot, 'Error:', err1)

  // 2. Clear all B-Wine tracks album info so it doesn't cross-contaminate
  const { data: clearedBWine, error: err2 } = await supabase
    .from('tracks')
    .update({ spotify_album_id: null, album: null })
    .ilike('artist', '%B-Wine%')
    .select('id, title, artist, album')

  console.log('Cleared B-Wine tracks:', clearedBWine, 'Error:', err2)
}

main().catch(console.error)
