import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/accessControl'
import { UploadForm } from '@/components/upload/UploadForm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { redirect } from 'next/navigation'

export default async function UploadPage() {
  const supabase = await createClient()
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser()

  const session = await getServerSession(authOptions)
  const userEmail = supabaseUser?.email || session?.user?.email
  const userIsAdmin = isAdmin(userEmail)

  if (!userIsAdmin) {
    redirect('/')
  }

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col justify-center min-h-[80vh] pb-36 lg:pb-8">
      <UploadForm />
    </div>
  )
}
