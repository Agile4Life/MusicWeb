const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { authorizePasswordCredentials } = require('../lib/auth/credentials')

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

// Set env vars so the function createSupabasePasswordClient can read them
process.env.NEXT_PUBLIC_SUPABASE_URL = url
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey

async function main() {
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })
  
  const testEmail = 'temp_test_auth_user@musicweb.com'
  const testPassword = 'password123'

  console.log(`Creating user ${testEmail}...`)
  
  // Clean up existing test user if any
  const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existingUser = listData?.users?.find(u => u.email === testEmail)
  if (existingUser) {
    console.log('Deleting existing test user...')
    await adminClient.auth.admin.deleteUser(existingUser.id)
  }

  // Create new user via admin api
  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  })

  if (createError) {
    console.error('Failed to create test user:', createError)
    return
  }

  console.log('Test user created successfully. ID:', createData.user.id)

  // Log in as test user to get access token
  const normalClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: signInData, error: signInError } = await normalClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  })

  if (signInError) {
    console.error('signInWithPassword failed:', signInError)
    return
  }

  const accessToken = signInData.session.access_token
  console.log('Log in succeeded. Access Token obtained.')

  // Call authorizePasswordCredentials
  console.log('Calling authorizePasswordCredentials...')
  const result = await authorizePasswordCredentials({
    email: testEmail,
    accessToken: accessToken
  })

  console.log('authorizePasswordCredentials returned:', result)

  // Clean up
  console.log('Cleaning up test user...')
  await adminClient.auth.admin.deleteUser(createData.user.id)
}

main().catch(console.error)
