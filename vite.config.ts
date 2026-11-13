import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { CSP_DIRECTIVES } from './src/lib/server/auth/csp.ts';

export default defineConfig({
	plugins: [
		{
			// `vite dev` / `vite preview` only: expose `.env` to server code through process.env,
			// which is what src/lib/server/config.ts reads. Real environment variables win.
			// Production (adapter-node in Docker) gets its env from the container; tests stay hermetic.
			name: 'worldview:dotenv-to-process-env',
			config(_, { command, mode }) {
				if (command !== 'serve' || mode === 'test') return;
				Object.assign(process.env, { ...loadEnv(mode, process.cwd(), ''), ...process.env });
			}
		},
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Hash mode: SvelteKit adds the sha256 of each page's inline hydration script to the
			// header; the app.html theme script hash is in CSP_DIRECTIVES (checked by csp.test.ts).
			csp: { mode: 'hash', directives: CSP_DIRECTIVES }
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// scripts/*.test.ts run the CLI scripts end to end (academy:sync).
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
