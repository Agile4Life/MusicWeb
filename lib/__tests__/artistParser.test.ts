import { describe, expect, it } from 'vitest'
import { parseArtists, getPrimaryArtistName } from '../artistParser'

describe('artistParser', () => {
  it('parses comma-separated artists without losing separators', () => {
    expect(parseArtists('RPT Orijinn, Low G, RZ Mas, RPT MCK')).toEqual([
      { name: 'RPT Orijinn', separator: ', ' },
      { name: 'Low G', separator: ', ' },
      { name: 'RZ Mas', separator: ', ' },
      { name: 'RPT MCK' },
    ])
  })

  it('parses feat/ft/x/×/& delimiters case-insensitively across multiple artists', () => {
    expect(parseArtists('Sơn Tùng M-TP feat. Snoop Dogg')).toEqual([
      { name: 'Sơn Tùng M-TP', separator: ' feat. ' },
      { name: 'Snoop Dogg' },
    ])
    expect(parseArtists('Vũ. Ft. Dear Jane & Binz')).toEqual([
      { name: 'Vũ.', separator: ' Ft. ' },
      { name: 'Dear Jane', separator: ' & ' },
      { name: 'Binz' },
    ])
    expect(parseArtists('Low G x tlinh × MCK')).toEqual([
      { name: 'Low G', separator: ' x ' },
      { name: 'tlinh', separator: ' × ' },
      { name: 'MCK' },
    ])
  })

  it('preserves slash inside artist names like W/N and AC/DC', () => {
    expect(parseArtists('W/N')).toEqual([{ name: 'W/N' }])
    expect(parseArtists('AC/DC')).toEqual([{ name: 'AC/DC' }])
    expect(parseArtists('W/N / DuongG / Nau')).toEqual([
      { name: 'W/N', separator: ' / ' },
      { name: 'DuongG', separator: ' / ' },
      { name: 'Nau' },
    ])
  })

  it('extracts primary artist name accurately', () => {
    expect(getPrimaryArtistName('Charlie Puth (feat. Jung Kook)')).toBe('Charlie Puth')
    expect(getPrimaryArtistName('W/N, 267, Par SG')).toBe('W/N')
  })
})

