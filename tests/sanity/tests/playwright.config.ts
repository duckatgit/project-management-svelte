import { devices, PlaywrightTestConfig } from '@playwright/test'
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

const config: PlaywrightTestConfig = {
  projects: [
    {
      name: 'Platform',
      use: {
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
        viewport: {
          width: 1440,
          height: 900
        },
        trace: {
          mode: 'retain-on-failure',
          snapshots: true,
          screenshots: true,
          sources: true
        }
      }
    }
  ],
  retries: 1,
  timeout: 60000,
  maxFailures: 5,
  expect: {
    timeout: 15000
  },
  reporter: [
    ['list'],
    ['html'],
    [
      'allure-playwright',
      {
        detail: true,
        suiteTitle: false
      }
    ]
  ]
}
export default config
