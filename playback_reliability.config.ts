import { defineConfig, devices } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { webkit } from 'playwright'

const scratch = resolve('scratch/playback-browser')
mkdirSync(scratch, { recursive: true })
writeFileSync(resolve(scratch, 'tsconfig.json'), JSON.stringify({
  extends: '../../tsconfig.json',
  compilerOptions: { paths: { '@/*': ['../../*'] }, tsBuildInfoFile: './tsconfig.tsbuildinfo' },
  include: ['../../next-env.d.ts', '../../app/**/*.ts', '../../app/**/*.tsx', '../../components/**/*.ts', '../../components/**/*.tsx', '../../lib/**/*.ts', '../../types/**/*.ts', './next/types/**/*.ts', './next/dev/types/**/*.ts'],
  exclude: ['../../node_modules'],
}, null, 2))
const localWebKit = resolve('scratch/playwright-browsers/webkit-2359/Playwright.exe')
const webkitExecutable = existsSync(localWebKit) ? localWebKit : webkit.executablePath()
const requestedRun = process.env.PLAYBACK_RELIABILITY_RUN
const runName = requestedRun && ['chromium-desktop', 'chromium-mobile', 'webkit-mobile'].includes(requestedRun) ? requestedRun : 'latest'
const runDirectory = resolve(scratch, runName)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'playback_reliability.spec.ts',
  outputDir: resolve(runDirectory, 'results'),
  reporter: [['list'], ['json', { outputFile: resolve(runDirectory, 'report.json') }]],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --port 3002 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3002',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_DIST_DIR: 'scratch/playback-browser/next',
      NEXT_TSCONFIG_PATH: 'scratch/playback-browser/tsconfig.json',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-fixture-key',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-fixture-key',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_ANON_KEY: 'test-fixture-key',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3002',
    serviceWorkers: 'block',
    trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false, sources: true },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    ...(existsSync(webkitExecutable) ? [{ name: 'webkit-mobile', use: { ...devices['iPhone 13'], launchOptions: { executablePath: webkitExecutable } } }] : []),
  ],
})
