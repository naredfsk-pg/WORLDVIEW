import { z } from 'zod';
import {
	AUTO_PUBLISH_POLICIES,
	DEFAULT_RELATION_AUTO_PUBLISH_MIN_CONFIDENCE
} from '../types/editorial';

/**
 * Server-only application config, parsed from environment variables with Zod.
 *
 * Reads `process.env` (not `$app/env/private`) so CLI scripts under `scripts/` can use it too.
 * In `vite dev` / `vite preview`, vite.config.ts copies `.env` into `process.env`; in production
 * the container provides the variables.
 *
 * LLM and Cloudflare secrets are optional at load time so dev, test and the public site work
 * without them. Features that need them call `requireLlmCredentials` / `requireCloudflareAccess`,
 * which fail with a clear message naming the missing variables (never their values).
 */

export type AppConfig = ReturnType<typeof toAppConfig>;

export class ConfigError extends Error {
	override name = 'ConfigError';
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
	cachedConfig ??= parseConfig(process.env);
	return cachedConfig;
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
	const present = withoutEmptyValues(env);
	const result = envSchema.safeParse(present);
	if (!result.success) {
		const problems = result.error.issues.map(
			(issue) => `${issue.path.join('.')}: ${issue.message}`
		);
		throw new ConfigError(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
	}
	return toAppConfig(result.data, present.NODE_ENV);
}

/**
 * Dev-only tools (`db:seed`, `db:reset`, `job ingest --fixtures`) need NODE_ENV set explicitly to
 * `development` or `test`. An allowlist on the raw value, not the parsed default: an unset
 * NODE_ENV (a container that forgot it) refuses, like `production` does.
 */
function isDevToolsEnv(rawNodeEnv: string | undefined): boolean {
	return rawNodeEnv === 'development' || rawNodeEnv === 'test';
}

export function requireLlmCredentials(config: AppConfig): { baseUrl: string; apiKey: string } {
	const { baseUrl, apiKey } = config.llm;
	const missing = [
		baseUrl ? null : 'LLM_BASE_URL (or OMNI_API_URL)',
		apiKey ? null : 'LLM_API_KEY (or OMNI_API_KEY)'
	].filter((name) => name !== null);

	if (!baseUrl || !apiKey) {
		throw new ConfigError(`LLM features need these environment variables: ${missing.join(', ')}`);
	}
	return { baseUrl, apiKey };
}

export function requireCloudflareAccess(config: AppConfig): {
	teamDomain: string;
	aud: string;
	adminAllowedEmails: string[];
} {
	const { accessTeamDomain, accessAud, adminAllowedEmails } = config.cloudflare;
	const missing = [
		accessTeamDomain ? null : 'CF_ACCESS_TEAM_DOMAIN',
		accessAud ? null : 'CF_ACCESS_AUD',
		adminAllowedEmails.length > 0 ? null : 'ADMIN_ALLOWED_EMAILS'
	].filter((name) => name !== null);

	if (!accessTeamDomain || !accessAud || adminAllowedEmails.length === 0) {
		throw new ConfigError(`Admin access needs these environment variables: ${missing.join(', ')}`);
	}
	return { teamDomain: accessTeamDomain, aud: accessAud, adminAllowedEmails };
}

// Empty values (`KEY=`) count as unset, so defaults and "optional" apply to them.
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string> {
	const entries = Object.entries(env)
		.map(([key, value]) => [key, value?.trim()] as const)
		.filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
	return Object.fromEntries(entries);
}

const positiveInt = (defaultValue: number) =>
	z.coerce.number().int().positive().default(defaultValue);

const commaList = z
	.string()
	.optional()
	.transform((value) =>
		(value ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	);

const databaseUrl = z
	.string()
	.refine((value) => value === ':memory:' || value.startsWith('file:'), {
		message: 'must be ":memory:" or start with "file:"'
	});

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

	// LLM endpoint: LLM_* wins, OMNI_* is the fallback alias. The API key and the prompts travel
	// in the request, so plain http is only for local or private hosts (ARCHITECTURE §14).
	OMNI_API_URL: llmEndpointUrl().optional(),
	OMNI_API_KEY: z.string().optional(),
	LLM_BASE_URL: llmEndpointUrl().optional(),
	LLM_API_KEY: z.string().optional(),
	LLM_API_COMPATIBILITY: z.enum(['openai_compatible', 'custom']).default('openai_compatible'),

	LLM_MODEL_ID: z.string().optional(),
	LLM_MODEL_TAGGING: z.string().optional(),
	LLM_MODEL_CLUSTERING: z.string().optional(),
	LLM_MODEL_EXTRACTION: z.string().optional(),
	LLM_MODEL_SUMMARY: z.string().optional(),
	LLM_MODEL_RELATIONS: z.string().optional(),
	LLM_MODEL_ACADEMY_LINKING: z.string().optional(),
	LLM_MODEL_FALLBACK: z.string().optional(),
	LLM_MODEL_FALLBACK_SECONDARY: z.string().optional(),
	LLM_OMIT_TEMPERATURE_FOR: commaList,

	LLM_TIMEOUT_SECONDS: positiveInt(90),
	LLM_MAX_CONCURRENCY: positiveInt(2),
	LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
	LLM_MAX_INPUT_TOKENS: positiveInt(32000),
	LLM_MAX_OUTPUT_TOKENS: positiveInt(4000),
	LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
	LLM_DAILY_MAX_REQUESTS: positiveInt(300),
	LLM_DAILY_MAX_TOKENS: positiveInt(600000),
	// One job run may send at most this many LLM requests, so one run cannot use most of the
	// daily cap (ARCHITECTURE §10).
	LLM_MAX_REQUESTS_PER_RUN: positiveInt(80),

	// Auto-publish policy of the digest (ARCHITECTURE §11). `off` (the default) sends every event
	// to an admin; `multi_source` auto-publishes only events reported by ≥ 2 registry sources;
	// `all` auto-publishes whatever passes the gates. Admin publish is never affected.
	EDITORIAL_AUTO_PUBLISH: z.enum(AUTO_PUBLISH_POLICIES).default('off'),
	// Only with `all`: a validated AI relation at or above this confidence is published, one below
	// it is dropped (ARCHITECTURE §11). 0.8 = CLUSTERING_MERGE_MIN_CONFIDENCE, the other "confident
	// model decision that changes public content" threshold.
	RELATIONS_AUTO_PUBLISH_MIN_CONFIDENCE: z.coerce
		.number()
		.min(0)
		.max(1)
		.default(DEFAULT_RELATION_AUTO_PUBLISH_MIN_CONFIDENCE),
	// New articles one source may add per ingest run (ARCHITECTURE §9).
	INGEST_MAX_NEW_ITEMS_PER_SOURCE: positiveInt(40),

	// Brief dates and schedules assume Bangkok (ARCHITECTURE §7); any other value is rejected.
	APP_TIMEZONE: z.literal('Asia/Bangkok').default('Asia/Bangkok'),
	DATABASE_URL: databaseUrl.default('file:./data/worldview.db'),
	DAILY_EVENT_TARGET_MIN: positiveInt(10),
	DAILY_EVENT_TARGET_MAX: positiveInt(15),

	// `db:backup` (scripts/backup.ts): target folder and how many backups to keep.
	BACKUP_DIR: z.string().default('./data/backups'),
	BACKUP_KEEP: positiveInt(14),

	COMPOSE_PROJECT_NAME: z.string().default('worldview'),
	PUBLIC_HOSTNAME: z.string().default('localhost'),
	PUBLIC_SITE_URL: z.url().default('http://localhost:5173'),

	// adapter-node reads these itself; they are parsed here for validation and visibility.
	ORIGIN: z.url().optional(),
	HOST: z.string().default('0.0.0.0'),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	ADDRESS_HEADER: z.string().optional(),
	BODY_SIZE_LIMIT: z.string().default('512K'),

	// TUNNEL_TOKEN is deliberately not parsed: only the cloudflared container needs it.
	CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
	CF_ACCESS_AUD: z.string().optional(),
	// Test-only JWKS URL for e2e against a production build. `server/auth` ignores it unless
	// NODE_ENV=test and both ORIGIN and this URL are loopback (ARCHITECTURE §4).
	CF_ACCESS_TEST_JWKS_URL: z.url().optional(),
	// Plain ASCII only (same rule as the JWT email check in server/auth), so Unicode case
	// mapping can never make two different addresses compare equal.
	ADMIN_ALLOWED_EMAILS: commaList.pipe(
		z.array(z.email().regex(/^[!-?A-~]+@[!-?A-~]+$/, 'must be a plain ASCII email address'))
	)
});

// A function declaration, so the schema above can use it before this point in the file.
function llmEndpointUrl() {
	return z.url().refine(
		(value) => {
			// An unparseable value is already reported by `z.url()`.
			if (!URL.canParse(value)) return true;
			const url = new URL(value);
			return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
		},
		// The issue path names the variable; the value is never echoed.
		{ message: 'must use https (http only for localhost, private or single-label hosts)' }
	);
}

/**
 * Loopback, private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), single-label names (docker
 * services such as `omniroute`) and `*.localhost` / `*.internal` / `*.local`. `URL` has already
 * lower-cased the name and normalised IPv4 (`0x7f.1` → `127.0.0.1`) and IPv6 (`[::1]`).
 */
function isLocalHost(hostname: string): boolean {
	if (hostname.startsWith('[')) {
		const ipv6 = hostname.slice(1, -1);
		return ipv6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(ipv6);
	}
	const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
	if (ipv4) {
		const [first, second] = [Number(ipv4[1]), Number(ipv4[2])];
		return (
			first === 10 ||
			first === 127 ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168)
		);
	}
	if (!hostname.includes('.')) return true;
	return ['localhost', 'internal', 'local'].some((suffix) => hostname.endsWith(`.${suffix}`));
}

function toAppConfig(env: z.infer<typeof envSchema>, rawNodeEnv: string | undefined) {
	if (env.DAILY_EVENT_TARGET_MIN > env.DAILY_EVENT_TARGET_MAX) {
		throw new ConfigError('DAILY_EVENT_TARGET_MIN must not be greater than DAILY_EVENT_TARGET_MAX');
	}

	const defaultModel = env.LLM_MODEL_ID;
	return {
		nodeEnv: env.NODE_ENV,
		/** NODE_ENV is explicitly `development` or `test` (dev-only tools may run). */
		devToolsAllowed: isDevToolsEnv(rawNodeEnv),
		app: {
			timezone: env.APP_TIMEZONE,
			databaseUrl: env.DATABASE_URL,
			dailyEventTargetMin: env.DAILY_EVENT_TARGET_MIN,
			dailyEventTargetMax: env.DAILY_EVENT_TARGET_MAX,
			composeProjectName: env.COMPOSE_PROJECT_NAME,
			publicHostname: env.PUBLIC_HOSTNAME,
			publicSiteUrl: env.PUBLIC_SITE_URL
		},
		backup: {
			dir: env.BACKUP_DIR,
			keep: env.BACKUP_KEEP
		},
		server: {
			origin: env.ORIGIN,
			host: env.HOST,
			port: env.PORT,
			addressHeader: env.ADDRESS_HEADER,
			bodySizeLimit: env.BODY_SIZE_LIMIT
		},
		llm: {
			baseUrl: env.LLM_BASE_URL ?? env.OMNI_API_URL,
			apiKey: env.LLM_API_KEY ?? env.OMNI_API_KEY,
			compatibility: env.LLM_API_COMPATIBILITY,
			// Per-task models fall back to LLM_MODEL_ID.
			models: {
				default: defaultModel,
				tagging: env.LLM_MODEL_TAGGING ?? defaultModel,
				clustering: env.LLM_MODEL_CLUSTERING ?? defaultModel,
				extraction: env.LLM_MODEL_EXTRACTION ?? defaultModel,
				summary: env.LLM_MODEL_SUMMARY ?? defaultModel,
				relations: env.LLM_MODEL_RELATIONS ?? defaultModel,
				academyLinking: env.LLM_MODEL_ACADEMY_LINKING ?? defaultModel,
				fallback: env.LLM_MODEL_FALLBACK,
				fallbackSecondary: env.LLM_MODEL_FALLBACK_SECONDARY
			},
			omitTemperatureFor: env.LLM_OMIT_TEMPERATURE_FOR,
			timeoutSeconds: env.LLM_TIMEOUT_SECONDS,
			maxConcurrency: env.LLM_MAX_CONCURRENCY,
			maxRetries: env.LLM_MAX_RETRIES,
			maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
			maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
			temperature: env.LLM_TEMPERATURE,
			dailyMaxRequests: env.LLM_DAILY_MAX_REQUESTS,
			dailyMaxTokens: env.LLM_DAILY_MAX_TOKENS,
			maxRequestsPerRun: env.LLM_MAX_REQUESTS_PER_RUN
		},
		editorial: {
			autoPublish: env.EDITORIAL_AUTO_PUBLISH,
			relationsMinConfidence: env.RELATIONS_AUTO_PUBLISH_MIN_CONFIDENCE
		},
		ingest: {
			maxNewItemsPerSource: env.INGEST_MAX_NEW_ITEMS_PER_SOURCE
		},
		cloudflare: {
			accessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN,
			accessAud: env.CF_ACCESS_AUD,
			testJwksUrl: env.CF_ACCESS_TEST_JWKS_URL,
			adminAllowedEmails: env.ADMIN_ALLOWED_EMAILS.map((email) => email.toLowerCase())
		}
	};
}
