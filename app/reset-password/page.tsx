'use client'

import React from 'react'
import Link from 'next/link'
import { Mail, ArrowLeft, ShieldAlert } from 'lucide-react'

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen w-screen bg-[var(--bg-space,#07080c)] flex items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Background Glow */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(29,185,84,0.12),transparent_100%)]" />

      {/* Card Container */}
      <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-[var(--primary-spotify)]/20 shadow-2xl relative overflow-hidden z-10 flex flex-col items-center text-center gap-6 animate-in zoom-in-95 duration-200">
        
        {/* Icon Header */}
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary-spotify)]/10 border border-[var(--primary-spotify)]/30 flex items-center justify-center text-[var(--primary-spotify)] shadow-lg shadow-[var(--theme-glow-shadow)]">
          <ShieldAlert className="w-8 h-8 text-[var(--primary-spotify)]" />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Quên Mật Khẩu</h1>
          <p className="text-xs text-slate-300 leading-relaxed px-2">
            Hệ thống không hỗ trợ tự động đặt lại mật khẩu. Vui lòng liên hệ trực tiếp <strong className="text-white">Admin</strong> qua Gmail để được hỗ trợ cấp lại mật khẩu tài khoản:
          </p>
          
          <div className="p-4 bg-emerald-500/10 border border-[var(--primary-spotify)]/30 rounded-2xl text-xs font-mono text-[var(--primary-spotify)] font-bold flex items-center justify-center gap-2 mt-2 shadow-inner">
            <Mail className="w-4 h-4 text-[var(--primary-spotify)] shrink-0" />
            <span className="select-all">tranphong16012006@gmail.com</span>
          </div>
        </div>

        {/* Back to Login Button */}
        <Link
          href="/login"
          className="w-full bg-[var(--primary-spotify)] text-black font-extrabold py-3.5 rounded-full hover:scale-105 transition-all text-xs shadow-lg flex items-center justify-center gap-2 mt-2"
        >
          <ArrowLeft className="w-4 h-4 text-black" />
          <span>Quay Lại Trang Đăng Nhập</span>
        </Link>
      </div>
    </main>
  )
}
