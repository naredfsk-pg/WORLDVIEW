import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_PORT } from './tests/e2e/admin-auth';

// Port: E2E_PORT (default 4173), e.g. `E2E_PORT=4273 npm run test:e2e`. The JWKS for admin
// tokens listens on E2E_JWKS_PORT (default E2E_PORT + 1).
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	globalSetup: './tests/e2e/admin-global-setup.ts',
	use: { baseURL: E2E_BASE_URL },
	projects: [
		{
			name: 'chromium',
			testIgnore: ['**/admin*.e2e.ts', '**/pipeline*.e2e.ts'],
			use: { ...devices['Desktop Chrome'] }
		},
		// Admin tests publish and hide seeded events, so they run after the public suite.
		{
			name: 'admin',
			testMatch: '**/admin*.e2e.ts',
			dependencies: ['chromium'],
			use: { ...devices['Desktop Chrome'] }
		},
		// The fixture pipeline (ingest → mock digest → briefs) writes new events and briefs into
		// the e2e database, so it runs last (docs/qa/ACCEPTANCE.md #6).
		{
			name: 'pipeline',
			testMatch: '**/pipeline*.e2e.ts',
			dependencies: ['admin'],
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		// Resets the e2e database, builds for production, then previews (see the file header).
		command: 'npx tsx tests/e2e/admin-e2e-server.ts',
		port: E2E_PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 300_000
	}
});
