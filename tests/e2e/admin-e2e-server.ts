/**
 * Playwright `webServer` for the whole e2e suite (`npx tsx tests/e2e/admin-e2e-server.ts`):
 * 1. reset the separate e2e database (seed data), so admin writes never touch `data/worldview.db`
 *    and every run starts from the same state
 * 2. `vite build` with NODE_ENV unset → a real production build (`import.meta.env.DEV` = false)
 * 3. `vite preview` of that build with the test-only auth env (`previewEnv()`)
 * The build must not see NODE_ENV=test: Vite would then produce a development build.
 */
import { spawn, spawnSync } from 'node:child_process';
import { E2E_DATABASE_URL, E2E_PORT, previewEnv } from './admin-auth';

const baseEnv: NodeJS.ProcessEnv = { ...process.env };
delete baseEnv.NODE_ENV;

runStep('npm run db:reset', { ...baseEnv, DATABASE_URL: E2E_DATABASE_URL });
runStep('npm run build', baseEnv);

const preview = spawn(`npm run preview -- --port ${E2E_PORT} --strictPort`, {
	shell: true,
	stdio: 'inherit',
	env: { ...baseEnv, ...previewEnv() }
});
preview.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => preview.kill(signal));
}

function runStep(command: string, env: NodeJS.ProcessEnv): void {
	const result = spawnSync(command, { shell: true, stdio: 'inherit', env });
	if (result.status !== 0) {
		console.error(`e2e server: "${command}" failed with exit code ${result.status}`);
		process.exit(result.status ?? 1);
	}
}
