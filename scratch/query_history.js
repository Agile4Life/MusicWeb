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
const anonKey = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('Testing tracks table insert using the ANON KEY...');
const anonClient = createClient(url, anonKey);

const dummyUserId = '00000000-0000-4000-a000-999999999999';
const dummyTrackId = '00000000-0000-4000-a000-888888888888';

async function main() {
  console.log('Trying to insert a track as anon...');
  const { data: insertTrackData, error: insertTrackError } = await anonClient
    .from('tracks')
    .insert({
      id: dummyTrackId,
      user_id: dummyUserId,
      title: 'Temp Test Track',
      file_path: 'temp:test',
      duration: 100
    })
    .select('id')
    .single()

  if (insertTrackError) {
    console.error('TRACK INSERT FAILED using ANON KEY:', insertTrackError);
  } else {
    console.log('TRACK INSERT SUCCESS using ANON KEY:', insertTrackData);
    
    // Clean up
    console.log('Cleaning up track entry...');
    const { error: deleteError } = await anonClient
      .from('tracks')
      .delete()
      .eq('id', dummyTrackId)
      
    if (deleteError) {
      console.error('TRACK DELETE FAILED using ANON KEY:', deleteError);
    } else {
      console.log('TRACK DELETE SUCCESS using ANON KEY');
    }
  }
}

main().catch(console.error)
