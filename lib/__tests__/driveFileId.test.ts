import { describe, expect, it } from 'vitest'
import { extractDriveFileId } from '@/lib/googleDriveUpload'

describe('extractDriveFileId', () => {
  it('extracts drive file ID from standard Google Drive URL', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/1sT-kP6Z9ABCDEF1234567890/view')).toBe('1sT-kP6Z9ABCDEF1234567890')
    expect(extractDriveFileId('https://drive.google.com/open?id=1sT-kP6Z9ABCDEF1234567890')).toBe('1sT-kP6Z9ABCDEF1234567890')
  })

  it('recognizes raw Google Drive file IDs without URL wrappers', () => {
    expect(extractDriveFileId('1sT-kP6Z9ABCDEF1234567890')).toBe('1sT-kP6Z9ABCDEF1234567890')
    expect(extractDriveFileId('1A2B3C4D5E6F7G8H9I0J_xyz')).toBe('1A2B3C4D5E6F7G8H9I0J_xyz')
  })

  it('rejects folder links and standard UUIDs', () => {
    expect(extractDriveFileId('https://drive.google.com/drive/folders/1sT-kP6Z9ABCDEF1234567890')).toBe(null)
    expect(extractDriveFileId('e4b9319a-9818-4ec8-b638-735702213768')).toBe(null)
    expect(extractDriveFileId('')).toBe(null)
  })
})
