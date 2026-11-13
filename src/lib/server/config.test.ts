import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig, requireCloudflareAccess, requireLlmCredentials } from './config';

describe('parseConfig', () => {
	it('loads with an empty environment (no LLM or Cloudflare secrets)', () => {
		const config = parseConfig({});

		expect(config.nodeEnv).toBe('development');
		expect(config.app.databaseUrl).toBe('file:./data/worldview.db');
		expect(config.app.timezone).toBe('Asia/Bangkok');
		expect(config.backup).toEqual({ dir: './data/backups', keep: 14 });
		expect(config.llm.baseUrl).toBeUndefined();
		expect(config.llm.apiKey).toBeUndefined();
		expect(config.llm.omitTemperatureFor).toEqual([]);
		expect(config.cloudflare.adminAllowedEmails).toEqual([]);
	});

	it.each([
		[undefined, false],
		['', false],
		['production', false],
		['development', true],
		['test', true]
	])(
		'allows dev-only tools only for an explicit development/test NODE_ENV (%j → %s)',
		(nodeEnv, allowed) => {
			const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
			expect(parseConfig(env).devToolsAllowed).toBe(allowed);
		}
	);

	it('treats empty values as unset', () => {
		const config = parseConfig({
			LLM_TIMEOUT_SECONDS: '',
			OMNI_API_KEY: '  ',
			ADMIN_ALLOWED_EMAILS: ''
		});

		expect(config.llm.timeoutSeconds).toBe(90);
		expect(config.llm.apiKey).toBeUndefined();
		expect(config.cloudflare.adminAllowedEmails).toEqual([]);
	});

	it('falls back from LLM_* to OMNI_* aliases', () => {
		const config = parseConfig({
			OMNI_API_URL: 'https://omni.example/v1',
			OMNI_API_KEY: 'omni-key'
		});

		expect(config.llm.baseUrl).toBe('https://omni.example/v1');
		expect(config.llm.apiKey).toBe('omni-key');
	});

	it('prefers LLM_* over OMNI_* when both are set', () => {
		const config = parseConfig({
			OMNI_API_URL: 'https://omni.example/v1',
			OMNI_API_KEY: 'omni-key',
			LLM_BASE_URL: 'https://llm.example/v1',
			LLM_API_KEY: 'llm-key'
		});

		expect(config.llm.baseUrl).toBe('https://llm.example/v1');
		expect(config.llm.apiKey).toBe('llm-key');
	});

	it('splits comma lists, trimming blanks and lower-casing emails', () => {
		const config = parseConfig({
			LLM_OMIT_TEMPERATURE_FOR: 'cc/claude-haiku-5-5, cx/other ,',
			ADMIN_ALLOWED_EMAILS: 'Admin@Example.com, ops@example.com'
		});

		expect(config.llm.omitTemperatureFor).toEqual(['cc/claude-haiku-5-5', 'cx/other']);
		expect(config.cloudflare.adminAllowedEmails).toEqual(['admin@example.com', 'ops@example.com']);
	});

	it('coerces numbers and lets per-task models fall back to LLM_MODEL_ID', () => {
		const config = parseConfig({
			LLM_MODEL_ID: 'cc/default',
			LLM_MODEL_TAGGING: 'cx/fast',
			LLM_MAX_CONCURRENCY: '4',
			LLM_TEMPERATURE: '0.3',
			PORT: '3000'
		});

		expect(config.llm.models.tagging).toBe('cx/fast');
		expect(config.llm.models.summary).toBe('cc/default');
		expect(config.llm.models.academyLinking).toBe('cc/default');
		expect(config.llm.maxConcurrency).toBe(4);
		expect(config.llm.temperature).toBe(0.3);
		expect(config.server.port).toBe(3000);
	});

	it.each([
		[{ LLM_MAX_CONCURRENCY: 'two' }, 'LLM_MAX_CONCURRENCY'],
		[{ LLM_TIMEOUT_SECONDS: '0' }, 'LLM_TIMEOUT_SECONDS'],
		[{ OMNI_API_URL: 'not-a-url' }, 'OMNI_API_URL'],
		[{ DATABASE_URL: './data/worldview.db' }, 'DATABASE_URL'],
		[{ BACKUP_KEEP: '0' }, 'BACKUP_KEEP'],
		[{ ADMIN_ALLOWED_EMAILS: 'nope' }, 'ADMIN_ALLOWED_EMAILS'],
		[{ NODE_ENV: 'staging' }, 'NODE_ENV'],
		[{ APP_TIMEZONE: 'UTC' }, 'APP_TIMEZONE'],
		[{ APP_TIMEZONE: 'Asia/Tokyo' }, 'APP_TIMEZONE']
	])('rejects invalid input %j and names the variable', (env, variable) => {
		expect(() => parseConfig(env)).toThrow(ConfigError);
		expect(() => parseConfig(env)).toThrow(variable);
	});

	it('lets LLM_MODEL_ACADEMY_LINKING override the default model', () => {
		const config = parseConfig({
			LLM_MODEL_ID: 'cc/default',
			LLM_MODEL_ACADEMY_LINKING: 'cx/link'
		});
		expect(config.llm.models.academyLinking).toBe('cx/link');
	});

	it('does not expose TUNNEL_TOKEN to the app (only cloudflared reads it)', () => {
		const config = parseConfig({ TUNNEL_TOKEN: 'tunnel-secret' });
		expect(JSON.stringify(config)).not.toContain('tunnel-secret');
	});

	it('rejects DAILY_EVENT_TARGET_MIN greater than MAX', () => {
		expect(() =>
			parseConfig({ DAILY_EVENT_TARGET_MIN: '20', DAILY_EVENT_TARGET_MAX: '15' })
		).toThrow(ConfigError);
	});

	it('never echoes secret values in validation errors', () => {
		const secret = 'sk-very-secret-value';
		try {
			parseConfig({ LLM_BASE_URL: secret, LLM_MAX_CONCURRENCY: 'x' });
			expect.unreachable();
		} catch (error) {
			expect(String(error)).not.toContain(secret);
		}
	});
});

describe('requireLlmCredentials', () => {
	it('returns credentials when both are set', () => {
		const config = parseConfig({ OMNI_API_URL: 'https://omni.example/v1', OMNI_API_KEY: 'k' });
		expect(requireLlmCredentials(config)).toEqual({
			baseUrl: 'https://omni.example/v1',
			apiKey: 'k'
		});
	});

	it('fails clearly, naming the missing variables', () => {
		const config = parseConfig({ OMNI_API_URL: 'https://omni.example/v1' });
		expect(() => requireLlmCredentials(config)).toThrow(/LLM_API_KEY \(or OMNI_API_KEY\)/);
		expect(() => requireLlmCredentials(config)).not.toThrow(/LLM_BASE_URL/);
	});
});

describe('requireCloudflareAccess', () => {
	it('fails clearly when Access settings are missing', () => {
		expect(() => requireCloudflareAccess(parseConfig({}))).toThrow(
			/CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_ALLOWED_EMAILS/
		);
	});

	it('returns Access settings when complete', () => {
		const config = parseConfig({
			CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
			CF_ACCESS_AUD: 'aud-tag',
			ADMIN_ALLOWED_EMAILS: 'admin@example.com'
		});
		expect(requireCloudflareAccess(config)).toEqual({
			teamDomain: 'team.cloudflareaccess.com',
			aud: 'aud-tag',
			adminAllowedEmails: ['admin@example.com']
		});
	});
});
