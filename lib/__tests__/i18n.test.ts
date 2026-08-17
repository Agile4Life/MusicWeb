import { describe, expect, it } from 'vitest'
import { translations, LANGUAGE_OPTIONS, Language } from '@/lib/i18n'

describe('i18n Localization Integrity Tests', () => {
  const languages: Language[] = ['vi', 'en', 'zh', 'ja']
  const viKeys = Object.keys(translations.vi).sort()

  it('provides all 4 supported languages in LANGUAGE_OPTIONS', () => {
    expect(LANGUAGE_OPTIONS).toHaveLength(4)
    expect(LANGUAGE_OPTIONS.map((l) => l.code)).toEqual(['vi', 'en', 'zh', 'ja'])
  })

  it('has comprehensive key coverage (> 100 translation keys per language)', () => {
    expect(viKeys.length).toBeGreaterThan(100)
  })

  languages.forEach((lang) => {
    it(`guarantees all keys present in 'vi' also exist in '${lang}' with non-empty string`, () => {
      const dict = translations[lang]
      expect(dict).toBeDefined()

      const missingKeys: string[] = []
      const emptyKeys: string[] = []

      viKeys.forEach((key) => {
        if (!(key in dict)) {
          missingKeys.push(key)
        } else if (!dict[key] || typeof dict[key] !== 'string' || dict[key].trim() === '') {
          emptyKeys.push(key)
        }
      })

      expect(missingKeys, `Missing keys in ${lang}`).toEqual([])
      expect(emptyKeys, `Empty keys in ${lang}`).toEqual([])
    })
  })
})
