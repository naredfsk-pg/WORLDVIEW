/**
 * `npm run verify:prod-build`: fails (exit 1) unless `build/` is a real production build.
 *
 * The admin dev bypass (`import.meta.env.DEV ? { email: 'dev@localhost' } : null`) only compiles
 * away when Vite builds with NODE_ENV=production (ARCHITECTURE §4.7). A development build, or a
 * `.env` with NODE_ENV in the build context, would bake it in. So every emitted file under
 * build/server, build/client and build/scripts must be free of `dev@localhost`. Source maps
 * (`*.map`) are skipped: they embed the original source text, branch included; the Docker build
 * deletes them and then greps the whole build/server tree as well.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = 'dev@localhost';
const ROOTS = ['build/server', 'build/client', 'build/scripts'];

function listFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? listFiles(path) : [path];
	});
}

if (!existsSync('build/server')) {
	console.error('verify:prod-build: build/server is missing; run `npm run build` first');
	process.exit(1);
}

const offenders: string[] = [];
let scanned = 0;
for (const root of ROOTS.filter((dir) => existsSync(dir))) {
	for (const file of listFiles(root)) {
		if (file.endsWith('.map')) continue;
		scanned += 1;
		if (readFileSync(file).includes(MARKER)) offenders.push(file);
	}
}

if (offenders.length > 0) {
	console.error(
		`verify:prod-build: "${MARKER}" found in ${offenders.length} file(s); this is not a production` +
			` build (build with NODE_ENV=production):\n- ${offenders.join('\n- ')}`
	);
	process.exit(1);
}
console.log(`verify:prod-build: ok (${scanned} files scanned, no dev bypass)`);
