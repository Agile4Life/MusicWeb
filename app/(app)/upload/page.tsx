import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/accessControl'
import { UploadForm } from '@/components/upload/UploadForm'
import Link from 'next/link'
import { ShieldAlert, Music } from 'lucide-react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

export default async function UploadPage() {
  const supabase = await createClient()
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser()

  const session = await getServerSession(authOptions)
  const userEmail = supabaseUser?.email || session?.user?.email
  const userIsAdmin = isAdmin(userEmail)

  if (!userIsAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="max-w-md glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center gap-4 bg-slate-900/80">
          <div className="w-16 h-16 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center border border-amber-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-white mb-2">Quyền Truy Cập Bị Hạn Chế</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tài khoản hiện tại của bạn (<strong>{userEmail || 'Người nghe'}</strong>) có quyền <strong className="text-emerald-400">Người nghe (Listener)</strong>.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Chỉ có các tài khoản <strong className="text-amber-400">Admin</strong> cấu hình trong tệp <code className="bg-black/50 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[11px]">config/allowedAccounts.json</code> mới có quyền đăng tải hoặc quản lý bài hát.
            </p>
          </div>

          <Link
            href="/"
            className="mt-3 bg-[var(--primary-spotify)] text-black font-extrabold px-6 py-2.5 rounded-full hover:scale-105 transition-transform flex items-center gap-2 text-xs shadow-lg shadow-[var(--theme-glow-shadow)]"
          >
            <Music className="w-4 h-4 fill-black" /> Quay về Nghe Nhạc
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col justify-center min-h-[80vh]">
      <UploadForm />
    </div>
  )
}
