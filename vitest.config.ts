import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    include: ['components/**/*.test.ts', 'lib/**/*.test.ts', 'app/**/*.test.ts', 'hooks/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/.worktrees/**', '**/.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
