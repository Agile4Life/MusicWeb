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
const key = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Supabase URL or Key missing')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  const email = 'admin@musicweb.com'
  const password = 'password123' // Wait, let's see if we can find the password or check if signInWithPassword succeeds

  console.log(`Testing supabase.auth.signInWithPassword for ${email}...`)
  
  // Since we don't know the exact password of the user, we will try to list users from admin Client
  // to see if admin@musicweb.com exists, and what their ID/email is.
  const serviceKey = envVars.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey) {
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 100
    })

    if (listError) {
      console.error('List users error:', listError)
    } else {
      const user = listData.users.find(u => u.email === email)
      console.log('User found in auth.users:', user ? {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
        last_sign_in_at: user.last_sign_in_at
      } : 'NOT FOUND')
    }
  }
}

main().catch(console.error)
