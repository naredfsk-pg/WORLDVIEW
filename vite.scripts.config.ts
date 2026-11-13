/**
 * `npm run build:scripts`: bundles the production CLI scripts into `build/scripts/*.js`, so the
 * Docker image runs them with plain `node` (no tsx, esbuild or TypeScript at runtime, smaller
 * RSS). Our own code (`#lib/*`) is bundled; npm packages stay external and load from the pruned
 * production `node_modules`, so every package these scripts import must be a `dependency` (the
 * image proves it: its start-up runs migrate + academy-sync against the pruned node_modules).
 * Run it after `vite build`: adapter-node empties `build/` first. Dev-only scripts (`seed`,
 * `db-reset`, `llm-smoke`) are not bundled.
 */
import { defineConfig } from 'vite';

export const SCRIPT_ENTRIES = ['job', 'migrate', 'academy-sync', 'backup', 'restore'] as const;

export default defineConfig({
	publicDir: false,
	// Nothing from .env may be inlined; the scripts read process.env at runtime (config.ts).
	envDir: false,
	build: {
		ssr: true,
		outDir: 'build/scripts',
		emptyOutDir: true,
		target: 'node24',
		minify: false,
		sourcemap: false,
		rolldownOptions: {
			input: Object.fromEntries(SCRIPT_ENTRIES.map((name) => [name, `scripts/${name}.ts`])),
			output: {
				format: 'esm',
				entryFileNames: '[name].js',
				chunkFileNames: 'chunks/[name]-[hash].js'
			}
		}
	}
});
