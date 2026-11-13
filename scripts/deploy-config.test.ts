/**
 * Guards for the deploy files (ARCHITECTURE §14, §17): TUNNEL_TOKEN reaches only cloudflared,
 * the app/scheduler environment matches the config contract and `.env.example`, and the
 * scheduler crontab is the §8 schedule in UTC.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ENV_VAR_NAMES } from '../src/lib/types/config';

const ROOT = resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

interface ComposeService {
	image?: string;
	env_file?: unknown;
	ports?: unknown;
	profiles?: string[];
	read_only?: boolean;
	cap_drop?: string[];
	security_opt?: string[];
	environment?: Record<string, string>;
	expose?: string[];
	networks?: string[];
	volumes?: string[];
	mem_limit?: string;
	pids_limit?: number;
	logging?: { driver: string; options: Record<string, string> };
}
const compose = parse(read('docker-compose.yml'), { merge: true }) as {
	name: string;
	services: Record<string, ComposeService>;
	networks: Record<string, unknown>;
};
/** Forced empty in app/scheduler: they would bypass SafeFetch or enable --inspect. */
const FORCED_EMPTY = [
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'http_proxy',
	'https_proxy',
	'NODE_USE_ENV_PROXY',
	'NODE_OPTIONS'
];
const { app, scheduler, cloudflared } = compose.services as Record<string, ComposeService>;

const exampleNames = read('.env.example')
	.split('\n')
	.map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
	.filter((name): name is string => Boolean(name));

describe('docker-compose.yml', () => {
	it('defines the worldview project with app, scheduler and cloudflared', () => {
		expect(compose.name).toBe('worldview');
		expect(Object.keys(compose.services).sort()).toEqual(['app', 'cloudflared', 'scheduler']);
	});

	it('gives TUNNEL_TOKEN to cloudflared only, and no service an env_file', () => {
		expect(Object.keys(cloudflared!.environment ?? {})).toEqual(['TUNNEL_TOKEN']);
		for (const service of Object.values(compose.services)) {
			expect(service.env_file).toBeUndefined();
		}
		for (const service of [app!, scheduler!]) {
			expect(service.environment).not.toHaveProperty('TUNNEL_TOKEN');
			expect(service.environment).not.toHaveProperty('CF_ACCESS_TEST_JWKS_URL');
		}
	});

	it('runs app and scheduler in production with the public origin, hardened, no published ports', () => {
		for (const service of [app!, scheduler!]) {
			expect(service.environment).toMatchObject({
				NODE_ENV: 'production',
				ORIGIN: 'https://worldview.nared-fu.com',
				ADDRESS_HEADER: 'CF-Connecting-IP',
				DATABASE_URL: 'file:/data/worldview.db'
			});
			expect(service.ports).toBeUndefined();
			expect(service.read_only).toBe(true);
			expect(service.cap_drop).toEqual(['ALL']);
			expect(service.security_opt).toContain('no-new-privileges:true');
			expect(service.mem_limit).toMatch(/^\d+m$/);
			expect(service.pids_limit).toBeGreaterThan(0);
			expect(service.logging).toMatchObject({ driver: 'json-file' });
			expect(service.logging?.options).toHaveProperty('max-size');
			expect(service.volumes?.some((volume) => volume.includes('docker.sock'))).toBe(false);
			for (const name of FORCED_EMPTY) expect(service.environment?.[name]).toBe('');
		}
		expect(app!.expose).toEqual(['3000']);
	});

	it('shares a dedicated network between app and cloudflared only', () => {
		expect(Object.keys(compose.networks).sort()).toEqual(['jobs', 'tunnel']);
		expect(app!.networks).toEqual(['tunnel']);
		expect(cloudflared!.networks).toEqual(['tunnel']);
		expect(scheduler!.networks).toEqual(['jobs']);
		expect(scheduler!.expose).toBeUndefined();
	});

	it('passes every app setting of .env.example, and only names from the config contract', () => {
		const appEnv = Object.keys(app!.environment ?? {});
		const notForApp = new Set(['TUNNEL_TOKEN', 'COMPOSE_PROJECT_NAME']);
		expect(exampleNames.filter((name) => !notForApp.has(name) && !appEnv.includes(name))).toEqual(
			[]
		);
		const known = new Set<string>([...ENV_VAR_NAMES, ...FORCED_EMPTY]);
		expect(appEnv.filter((name) => !known.has(name))).toEqual([]);
	});

	it('pins cloudflared to a version tag and digest and keeps it behind the tunnel profile', () => {
		expect(cloudflared!.image).toMatch(
			/^cloudflare\/cloudflared:\d{4}\.\d+\.\d+@sha256:[0-9a-f]{64}$/
		);
		expect(cloudflared!.profiles).toEqual(['tunnel']);
	});
});

describe('Dockerfile and .dockerignore', () => {
	const dockerfile = read('Dockerfile');

	it('pins the Node base image by exact version and digest, builds and runs in production', () => {
		const bases = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
		expect(bases).toHaveLength(2);
		for (const base of bases) {
			expect(base).toMatch(/^node:\d+\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/);
		}
		expect(dockerfile.match(/^ENV NODE_ENV=production/gm)).toHaveLength(2);
		expect(dockerfile).toMatch(/^USER node$/m);
		expect(dockerfile).toContain('npm run verify:prod-build');
		expect(dockerfile).toContain("grep -rl 'dev@localhost' build/server");
		expect(dockerfile).toContain('npm prune --omit=dev');
	});

	it('keeps secrets, data, tests and docs out of the build context', () => {
		const ignored = read('.dockerignore')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#'));
		for (const entry of [
			'.env',
			'.env.*',
			'!.env.example',
			'scripts/dev-tools.env',
			'.git',
			'data',
			'node_modules',
			'.svelte-kit',
			'build',
			'tests',
			'docs/screenshots',
			'worldview-ui-prototype'
		]) {
			expect(ignored).toContain(entry);
		}
	});
});

describe('docker/crontab', () => {
	const entries = read('docker/crontab')
		.split('\n')
		.filter((line) => line.trim() && !line.startsWith('#'))
		.map((line) => {
			const fields = line.trim().split(/\s+/);
			return { cron: fields.slice(0, 5).join(' '), command: fields.slice(5).join(' ') };
		});

	it('runs the ARCHITECTURE §8 schedule in UTC plus the daily backup', () => {
		const job = (type: string) => `node build/scripts/job.js ${type}`;
		const ingestDigest = `${job('ingest')}; ${job('digest')}`;
		expect(entries).toEqual([
			{ cron: '0 23 * * *', command: ingestDigest }, // 06:00 ICT
			{ cron: '0 0 * * *', command: job('brief_morning') }, // 07:00 ICT
			{ cron: '0 5 * * *', command: ingestDigest }, // 12:00 ICT
			{ cron: '0 11 * * *', command: ingestDigest }, // 18:00 ICT
			{ cron: '0 12 * * *', command: job('brief_evening') }, // 19:00 ICT
			{ cron: '0 16 * * *', command: ingestDigest }, // 23:00 ICT
			{ cron: '0 18 * * *', command: job('archive_snapshot') }, // 01:00 ICT
			{ cron: '30 19 * * *', command: 'node build/scripts/backup.js' } // 02:30 ICT
		]);
	});

	it('never seeds demo data or uses fixtures (crontab and app start commands)', () => {
		const commands = `${read('docker/crontab')}\n${read('docker/start-app.sh')}`
			.split('\n')
			.filter((line) => line.trim() && !line.trim().startsWith('#'));
		expect(commands.filter((line) => /seed|--fixtures/.test(line))).toEqual([]);
		expect(read('docker/start-app.sh')).toMatch(
			/node build\/scripts\/migrate\.js\nnode build\/scripts\/academy-sync\.js\nexec node build\n/
		);
	});
});
