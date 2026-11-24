'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { markEmailAsAllowed } from '@/lib/accessControl'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { LanguageSelector } from '@/components/i18n/LanguageSelector'
import { useTheme } from '@/components/theme/ThemeContext'
import { safeAuthReturnTo, scheduleAuthRedirect } from './authNavigation'
import { createPasswordSession } from './passwordSession'
import { Lock, Mail, User, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, Info } from 'lucide-react'

interface AuthFormProps {
  mode: 'login' | 'register'
}

declare global {
  interface Window {
    google?: any
  }
}

function translateAuthError(err: any): string {
  if (!err) return 'Đã xảy ra lỗi không xác định'

  let errorMessage = ''
  const errStatus = err.status || err.code || ''
  const errName = err.name || ''

  if (typeof err === 'string') {
    errorMessage = err
  } else if (err && typeof err.message === 'string' && err.message !== '{}') {
    errorMessage = err.message
  } else if (err && typeof err.error_description === 'string') {
    errorMessage = err.error_description
  } else {
    try {
      errorMessage = JSON.stringify(err)
    } catch {
      errorMessage = String(err)
    }
  }

  const msg = errorMessage.toLowerCase()

  if (msg === '{}' || errName === 'AuthRetryableFetchError' || errStatus === 500) {
    return process.env.NODE_ENV === 'development'
      ? 'Lỗi 500 từ Supabase Auth Server (auth.users). Vui lòng kiểm tra Supabase Dashboard > Auth > Users.'
      : 'Máy chủ xác thực đang gặp sự cố. Vui lòng thử lại sau ít phút hoặc liên hệ Admin.'
  }

  if (msg.includes('invalid login credentials')) return 'Email hoặc mật khẩu không chính xác'
  if (msg.includes('user already registered') || msg.includes('already exists')) return 'Email này đã được đăng ký tài khoản'
  if (msg.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự'
  if (msg.includes('invalid email')) return 'Định dạng email không hợp lệ'
  if (msg.includes('email not confirmed')) {
    return process.env.NODE_ENV === 'development'
      ? 'Tài khoản chưa được xác nhận email. Hãy kiểm tra hộp thư hoặc tắt Confirm email trong Supabase Dashboard.'
      : 'Tài khoản chưa được xác nhận email. Vui lòng kiểm tra hộp thư của bạn.'
  }
  if (msg.includes('over_email_send_rate_limit') || msg.includes('email rate limit exceeded')) {
    return process.env.NODE_ENV === 'development'
      ? 'Gửi email xác nhận bị quá giới hạn (Rate Limit). Tắt Confirm email trong Supabase để tạo tài khoản nhanh khi test.'
      : 'Bạn đã gửi yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.'
  }

  return errorMessage && errorMessage !== '{}'
    ? errorMessage
    : `Lỗi xác thực (${errName || 'AuthError'} ${errStatus ? 'Code: ' + errStatus : ''})`
}

export function AuthForm({ mode }: AuthFormProps) {
  const { t } = useLanguage()
  const { themeStyle } = useTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeAuthReturnTo(searchParams.get('returnTo'))
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [realEmail, setRealEmail] = useState('') // Optional Gmail for linking
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [ssoNotice, setSsoNotice] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>(mode)

  // Map a login account (username or email) to the auth email used by Supabase.
  // Plain usernames are treated as <username>@musicweb.com accounts.
  const toAuthEmail = (account: string): string => {
    const trimmed = account.trim().toLowerCase()
    if (!trimmed) return ''
    if (trimmed.includes('@')) return trimmed
    return `${trimmed}@musicweb.com`
  }

  useEffect(() => {
    if (searchParams) {
      // Middleware used to rewrite /sso/complete → /login while keeping
      // ?email=&accessToken=. Consume that handoff instead of ignoring it.
      const ssoEmail = searchParams.get('email')
      const ssoAccessToken = searchParams.get('accessToken')
      if (ssoEmail && ssoAccessToken) {
        const next = new URLSearchParams({ email: ssoEmail, accessToken: ssoAccessToken })
        router.replace(`/sso/complete?${next.toString()}`)
        return
      }
      const errParam = searchParams.get('error')
      const unapprovedEmailParam = searchParams.get('unapprovedEmail')
      if (errParam === 'UnapprovedAccount' || errParam === 'OAuthCallback' || errParam === 'AccessDenied') {
        const mailText = unapprovedEmailParam ? ` (${unapprovedEmailParam})` : ''
        setError(`Tài khoản${mailText} chưa được cấp phép. Vui lòng liên hệ Admin để được cấp quyền!`)
      }
      // Landed here after a failed handoff from /api/sso (see hoilauchay's
      // "Nhạc" nav link) — this isn't the visitor's mistake, so it gets its
      // own calmer notice rather than the red error banner.
      if (errParam === 'SsoInvalid' || errParam === 'SsoUnavailable' || errParam === 'SsoProvisionFailed' || errParam === 'SsoSessionFailed') {
        setSsoNotice('Không thể tự động đăng nhập từ Hội Lẩu chay. Vui lòng đăng nhập thủ công bên dưới, hoặc thử lại từ nút "Nhạc" bên đó.')
      }
    }
  }, [searchParams, router])



  useEffect(() => {
    const handleFocus = () => {
      setLoading(false)
    }

    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setRawError(null)
    setSuccessMsg(null)

    if (password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự')
      setLoading(false)
      return
    }

    const authEmail = toAuthEmail(email)

    try {
      if (authMode === 'register') {
        if (confirmPassword !== password) {
          setError('Mật khẩu xác nhận không khớp')
          setLoading(false)
          return
        }

        // Use Admin API register — creates account instantly, no email confirmation needed
        const regRes = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: email.trim(), // user types "tranphong", no @ required
            password,
            realEmail: realEmail.trim() || undefined,
          }),
        })
        const regData = await regRes.json()
        if (!regRes.ok || !regData.ok) {
          setError(regData.error || 'Đăng ký thất bại. Vui lòng thử lại!')
          setLoading(false)
          return
        }

        // Auto sign-in immediately after registration
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: regData.authEmail,
          password,
        })

        if (signInError || !signInData.session?.access_token) {
          setSuccessMsg('Đăng ký thành công! Hãy đăng nhập bằng tên tài khoản và mật khẩu vừa tạo.')
          setAuthMode('login')
          setTimeout(() => router.push(returnTo === '/spotify-lab' ? '/login?returnTo=%2Fspotify-lab' : '/login'), 2200)
          setLoading(false)
          return
        }

        markEmailAsAllowed(regData.authEmail)
        setSuccessMsg('Đăng ký thành công! Đang chuyển hướng...')
        await createPasswordSession(signIn, regData.authEmail, signInData.session.access_token)
        scheduleAuthRedirect(router, 800, returnTo)

      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        })

        if (signInError) {
          const errMsg = signInError.message?.toLowerCase() ?? ''
          // Auto-confirm: if Supabase requires email confirmation, force-confirm via API then retry
          if (errMsg.includes('email not confirmed')) {
            try {
              await fetch('/api/approve-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: authEmail }),
              })
            } catch {}

            // Retry sign-in after auto-confirm
            const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
              email: authEmail,
              password,
            })

            if (retryError) {
              setError(translateAuthError(retryError))
              setLoading(false)
              return
            }

            if (retryData.session?.access_token) {
              setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...')
              await createPasswordSession(signIn, authEmail, retryData.session.access_token)
              scheduleAuthRedirect(router, 800, returnTo)
              return
            }
          }

          setError(translateAuthError(signInError))
          setLoading(false)
          return
        }

        setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...')
        if (!signInData.session?.access_token) {
          setError('Không thể tạo phiên đăng nhập. Vui lòng thử lại!')
          setLoading(false)
          return
        }

        await createPasswordSession(signIn, authEmail, signInData.session.access_token)
        scheduleAuthRedirect(router, 800, returnTo)
      }

    } catch (err: any) {
      setError(translateAuthError(err))
      try {
        setRawError(
          typeof err === 'object'
            ? JSON.stringify(
                {
                  name: err.name,
                  message: err.message,
                  status: err.status,
                  code: err.code,
                  error_description: err.error_description,
                },
                null,
                2
              )
            : String(err)
        )
      } catch {
        setRawError(String(err))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = () => {
    setLoading(true)
    setError(null)
    setRawError(null)
    setSuccessMsg(null)
    signIn('google', { callbackUrl: returnTo })
  }



  const isMinimalFlat = themeStyle === 'minimal-flat'

  // Original, invented atmosphere copy for the lyric wall below — never real
  // song lyrics (copyright), just short evocative lines in the product's own
  // voice.
  const lyricLines = [
    { text: 'để em nghe gió hát', top: '6%', left: '-2%', size: 84, rotate: -6, opacity: 0.06 },
    { text: 'âm thanh cũ, cảm xúc mới', top: '30%', left: '-4%', size: 72, rotate: -4, opacity: 0.07 },
    { text: 'nhắm mắt, nghe nhịp thành phố', top: '52%', left: '2%', size: 96, rotate: 5, opacity: 0.055 },
    { text: 'giai điệu này là của riêng mình', top: '76%', left: '-3%', size: 80, rotate: -3, opacity: 0.06 },
  ]

  return (
    <div
      className="h-[100dvh] w-full overflow-y-auto flex justify-center lg:justify-end p-4 sm:p-6 lg:py-20 lg:pr-16 relative select-none"
      style={{ background: 'var(--bg-space, #07090e)' }}
    >
      {/* Ambient wash behind the docked card */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: 'radial-gradient(900px circle at 82% 8%, color-mix(in srgb, var(--spotify-glow,#22d3ee) 12%, transparent), transparent 70%)' }}
      />

      {/* Lyric typographic wall */}
      <div className="hidden lg:block pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        {lyricLines.map((line) => (
          <div
            key={line.text}
            style={{
              position: 'absolute',
              top: line.top,
              left: line.left,
              fontFamily: 'var(--font-fraunces, serif)',
              fontWeight: 600,
              fontSize: `${line.size}px`,
              color: `rgba(240,236,232,${line.opacity})`,
              transform: `rotate(${line.rotate}deg)`,
              whiteSpace: 'nowrap',
            }}
          >
            {line.text}
          </div>
        ))}
      </div>

      {/* Wordmark — top left */}
      <div className="fixed top-6 left-6 sm:top-8 sm:left-10 z-30 flex items-center">
        <img
          src="/phong-signature.png"
          alt="MusicWeb"
          className="h-8 sm:h-9 w-auto object-contain signature-img-invert"
        />
      </div>
      {/* Language Selector — top right */}
      <div className="fixed top-6 right-6 sm:top-8 sm:right-10 z-30">
        <LanguageSelector variant="flag-only" />
      </div>

      {/* Docked Auth Card */}
      <div
        style={
          isMinimalFlat
            ? {
                background: 'var(--surface, #1D1720)',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
                border: '1px solid var(--hair-strong, rgba(244, 236, 230, 0.16))',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
              }
            : {
                background:
                  'linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 60%, hsla(var(--base-h, 224), var(--base-s, 45%), 10%, 0.35) 100%)',
                backdropFilter: 'blur(28px) saturate(180%) brightness(1.06)',
                WebkitBackdropFilter: 'blur(28px) saturate(180%) brightness(1.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow:
                  '0 40px 90px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.14)',
              }
        }
        className="w-full max-w-[440px] rounded-2xl relative z-10 overflow-hidden my-auto mt-16 lg:my-auto"
      >
        <div className="px-6 sm:px-8 py-7 sm:py-8 relative z-10">

          <div className="flex flex-col gap-1.5 mb-5 relative z-10">
            <h1
              style={{ fontFamily: 'var(--font-fraunces, serif)' }}
              className="text-2xl sm:text-[26px] font-bold text-white tracking-tight"
            >
              {authMode === 'login' ? t('welcome_back') : t('register')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
              {t('login_subtitle')}
            </p>
          </div>

        {ssoNotice && (
          <div className="mb-4 p-3.5 bg-[var(--spotify-glow,#22d3ee)]/10 border border-[var(--spotify-glow,#22d3ee)]/30 text-[var(--spotify-glow,#22d3ee)] rounded-2xl text-xs flex items-start gap-2 relative z-10">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-semibold leading-relaxed">{ssoNotice}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl text-xs flex flex-col gap-2 relative z-10">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{error}</span>
            </div>
            {process.env.NODE_ENV === 'development' && rawError && (
              <details className="mt-1 pt-2 border-t border-red-500/20 text-[11px] font-mono text-red-300">
                <summary className="cursor-pointer hover:underline text-[10px] uppercase font-bold tracking-wider text-red-400/90">
                  Debug Log
                </summary>
                <pre className="mt-2 p-2.5 bg-black/60 rounded-xl overflow-x-auto whitespace-pre-wrap select-text text-[10px] text-red-300 border border-red-500/20">
                  {rawError}
                </pre>
              </details>
            )}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-[var(--primary-spotify)]/10 border border-[var(--primary-spotify)]/30 text-[var(--spotify-glow,#22d3ee)] rounded-2xl text-xs flex items-center gap-2 relative z-10">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Account & Password Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 relative z-20 w-full">
          <div>
            <label htmlFor="auth-account" className="block text-xs font-bold text-slate-300 mb-1.5">{t('account_label')}</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
              <input
                id="auth-account"
                type="text"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                  setRawError(null)
                }}
                placeholder={t('account_placeholder')}
                className="w-full glass-3d-input rounded-2xl pl-10 pr-4 py-3 text-xs sm:text-sm text-white outline-none placeholder:text-slate-400 relative z-0 cursor-text pointer-events-auto"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-bold text-slate-300 mb-1.5">{t('password_label')}</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                  setRawError(null)
                }}
                placeholder={t('password_placeholder')}
                className="w-full glass-3d-input rounded-2xl pl-10 pr-12 py-3 text-xs sm:text-sm text-white outline-none placeholder:text-slate-400 relative z-0 cursor-text pointer-events-auto"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors z-10 cursor-pointer p-1.5"
                tabIndex={-1}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {authMode === 'register' && (
            <div>
              <label htmlFor="auth-confirm-password" className="block text-xs font-bold text-slate-300 mb-1.5">{t('confirm_password')}</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setError(null)
                    setRawError(null)
                  }}
                  placeholder={t('password_placeholder')}
                  className="w-full glass-3d-input rounded-2xl pl-10 pr-4 py-3 text-xs sm:text-sm text-white outline-none placeholder:text-slate-400 relative z-0 cursor-text pointer-events-auto"
                />
              </div>
            </div>
          )}

          {/* Optional Gmail linking — only shown in register mode */}
          {authMode === 'register' && (
            <div>
              <label htmlFor="auth-real-email" className="block text-xs font-bold text-slate-300 mb-1.5">
                Gmail liên kết{' '}
                <span className="text-slate-400 font-normal text-[10px]">(tuỳ chọn, để đăng nhập bằng Google sau)</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
                <input
                  id="auth-real-email"
                  type="email"
                  autoComplete="email"
                  value={realEmail}
                  onChange={(e) => {
                    setRealEmail(e.target.value)
                    setError(null)
                  }}
                  placeholder="example@gmail.com"
                  className="w-full glass-3d-input rounded-2xl pl-10 pr-4 py-3 text-xs sm:text-sm text-white outline-none placeholder:text-slate-400 relative z-0 cursor-text pointer-events-auto"
                />
              </div>
            </div>
          )}


          {/* Forgot Password */}
          {authMode === 'login' && (
            <div className="flex justify-end -mt-1">
              <Link
                href="/reset-password"
                className="text-xs font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline transition-colors relative z-10"
              >
                {t('forgot_password')}
              </Link>
            </div>
          )}

          {/* Submit */}
          <div className="relative z-10">
            <button
              type="submit"
              disabled={loading}
              className="btn-3d-primary w-full text-black font-extrabold py-3.5 rounded-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:hover:scale-100 text-xs sm:text-sm shadow-xl"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>{authMode === 'login' ? t('logging_in') : t('registering')}</span>
                </>
              ) : (
                <span>{authMode === 'login' ? t('login_submit') : t('register')}</span>
              )}
            </button>
          </div>

          {/* Toggle Mode */}
          <div className="text-center text-xs text-slate-400 mt-1 relative z-10">
            {authMode === 'login' ? (
              <>
                {t('no_account')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register')
                    setError(null)
                    setRawError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline cursor-pointer"
                >
                  {t('register_now')}
                </button>
              </>
            ) : (
              <>
                {t('have_account')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login')
                    setError(null)
                    setRawError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline cursor-pointer"
                >
                  {t('login_now')}
                </button>
              </>
            )}
          </div>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5 relative z-10">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{t('or_continue_with')}</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Google Sign-In */}
        <div className="flex flex-col gap-3 relative z-10 w-full mt-1">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full bg-white/95 hover:bg-white text-slate-900 font-extrabold py-3.5 rounded-full transition-colors flex items-center justify-center gap-3 shadow-lg shadow-white/10 disabled:opacity-50 disabled:hover:scale-100 text-xs sm:text-sm cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{t('google_login')}</span>
          </button>

        </div>

        </div>
      </div>

    </div>
  )
}
