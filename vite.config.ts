import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

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
			adapter: adapter()
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
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
