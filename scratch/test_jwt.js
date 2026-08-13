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
const serviceKey = envVars.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  console.error('Supabase URL, Anon Key or Service Key missing')
  process.exit(1)
}

async function main() {
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })
  const normalClient = createClient(url, anonKey, { auth: { persistSession: false } })

  console.log('Generating session for admin@musicweb.com...')
  const { data: sessionData, error: sessionError } = await adminClient.auth.admin.createSession({
    user_id: 'a1b2c3d4-e5f6-7890-abcd-111111111111'
  })

  if (sessionError) {
    console.error('Failed to generate session:', sessionError)
    return
  }

  const accessToken = sessionData.session.access_token
  console.log('Access token generated successfully. Length:', accessToken.length)

  console.log('Testing getUser(accessToken) using anon client...')
  const { data: userData, error: userError } = await normalClient.auth.getUser(accessToken)

  if (userError) {
    console.error('getUser failed:', userError)
  } else {
    console.log('getUser succeeded! User email:', userData.user.email)
    console.log('Matches email admin@musicweb.com:', userData.user.email === 'admin@musicweb.com')
  }
}

main().catch(console.error)
