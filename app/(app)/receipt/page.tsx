'use client'

import { ReceiptifyView } from '@/components/player/ReceiptifyView'
import { Receipt, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function ReceiptPage() {
  const router = useRouter()

  return (
    <div className="flex-1 flex flex-col min-h-0 text-slate-100 select-none pb-24 lg:pb-8 p-3 sm:p-5 lg:p-6 max-w-6xl mx-auto w-full">
      {/* Page Top Header Bar */}
      <div className="hero-banner relative overflow-hidden rounded-2xl border border-white/[0.06] px-4 sm:px-6 py-3 sm:py-4 bg-[var(--elevation-1-bg,#0d1017)] flex items-center justify-between mb-4 lg:mb-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-1 text-slate-400 hover:text-white rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors lg:hidden shrink-0"
            title="Quay lại"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="w-10 h-10 rounded-xl bg-[var(--spotify-glow,#22d3ee)]/15 border border-[var(--spotify-glow,#22d3ee)]/25 flex items-center justify-center text-[var(--spotify-glow,#22d3ee)] shrink-0">
            <Receipt className="w-5 h-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2 truncate">
              <span className="truncate">Hóa đơn âm nhạc</span>
              <span className="text-[10px] font-mono font-semibold text-slate-400 shrink-0 hidden sm:inline">
                · Receiptify
              </span>
            </h1>
            <p className="text-xs text-slate-400 truncate hidden sm:block">
              Tạo và lưu hóa đơn in nhiệt từ danh sách bài hát của bạn
            </p>
          </div>
        </div>
      </div>

      {/* Full Page Receiptify Studio Container */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <ReceiptifyView isOpen={true} isPageMode={true} />
      </div>
    </div>
  )
}
