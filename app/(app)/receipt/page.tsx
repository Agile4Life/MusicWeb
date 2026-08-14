'use client'

import React from 'react'
import { ReceiptifyView } from '@/components/player/ReceiptifyView'
import { Receipt, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function ReceiptPage() {
  const router = useRouter()

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full text-slate-100 select-none pb-28 lg:pb-36 p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto w-full">
      {/* Page Top Header Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl mb-4 lg:mb-6 shrink-0 shadow-lg">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-1 text-slate-400 hover:text-white rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] active:scale-95 transition-all lg:hidden shrink-0"
            title="Quay lại"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="w-10 h-10 rounded-2xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.25)] shrink-0">
            <Receipt className="w-5 h-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2 truncate">
              <span>Hóa đơn âm nhạc</span>
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 shrink-0">
                Receiptify
              </span>
            </h1>
            <p className="text-xs text-slate-400 truncate hidden xs:block">
              Tạo và chia sẻ hóa đơn in nhiệt siêu thị cổ điển từ danh sách bài hát của bạn
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
