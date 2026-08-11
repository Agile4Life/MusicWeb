export interface CursorConfig {
  id: string
  name: string
  desc: string
  themeColor: string
  bgClass: string
  borderClass: string
  shadowClass: string
}

export const CURSOR_CONFIGS: CursorConfig[] = [
  {
    id: 'lottie',
    name: 'Lottie Synth',
    desc: 'Con trỏ phát sáng động',
    themeColor: 'cyan',
    bgClass: 'bg-cyan-500/20',
    borderClass: 'border-cyan-500/40',
    shadowClass: 'shadow-[0_0_12px_rgba(6,182,212,0.35)]',
  },
  {
    id: 'virtual-singer',
    name: 'VirtualSinger',
    desc: 'Hatsune Miku Anime',
    themeColor: 'pink',
    bgClass: 'bg-pink-500/15',
    borderClass: 'border-pink-500/30',
    shadowClass: 'shadow-[0_0_12px_rgba(236,72,153,0.3)]',
  },
  {
    id: 'furina',
    name: 'Furina (Fontaine)',
    desc: 'Genshin Impact Anime',
    themeColor: 'blue',
    bgClass: 'bg-blue-500/15',
    borderClass: 'border-blue-500/30',
    shadowClass: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
  },
  {
    id: 'haru-urara',
    name: 'Haru Urara',
    desc: 'Uma Musume Anime',
    themeColor: 'rose',
    bgClass: 'bg-rose-500/15',
    borderClass: 'border-rose-500/30',
    shadowClass: 'shadow-[0_0_12px_rgba(244,63,94,0.3)]',
  },
  {
    id: 'default',
    name: 'Hệ thống (Default)',
    desc: 'Con trỏ mặc định',
    themeColor: 'slate',
    bgClass: 'bg-white/10',
    borderClass: 'border-white/15',
    shadowClass: '',
  },
]
