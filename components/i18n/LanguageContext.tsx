'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Language, translations, LANGUAGE_OPTIONS, LanguageOption } from '@/lib/i18n'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, fallback?: string) => string
  options: LanguageOption[]
  currentOption: LanguageOption
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('vi')

  useEffect(() => {
    // Restore language preference from localStorage
    const saved = localStorage.getItem('musicweb_language') as Language
    if (saved && ['vi', 'en', 'zh', 'ja'].includes(saved)) {
      setLanguageState(saved)
    }
  }, [])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('musicweb_language', lang)
  }

  const t = (key: string, fallback?: string): string => {
    const dict = translations[language] || translations.vi
    if (dict && dict[key]) {
      return dict[key]
    }
    // Fallback to Vietnamese dictionary
    if (translations.vi[key]) {
      return translations.vi[key]
    }
    return fallback || key
  }

  const currentOption = LANGUAGE_OPTIONS.find((opt) => opt.code === language) || LANGUAGE_OPTIONS[0]

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, options: LANGUAGE_OPTIONS, currentOption }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    // Return default fallback if used outside Provider
    const currentOption = LANGUAGE_OPTIONS[0]
    return {
      language: 'vi' as Language,
      setLanguage: () => {},
      t: (key: string, fallback?: string) => translations.vi[key] || fallback || key,
      options: LANGUAGE_OPTIONS,
      currentOption,
    }
  }
  return context
}
