import { z } from 'zod';

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

	// LLM endpoint: LLM_* wins, OMNI_* is the fallback alias.
	OMNI_API_URL: z.url().optional(),
	OMNI_API_KEY: z.string().optional(),
	LLM_BASE_URL: z.url().optional(),
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
			dailyMaxTokens: env.LLM_DAILY_MAX_TOKENS
		},
		cloudflare: {
			accessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN,
			accessAud: env.CF_ACCESS_AUD,
			testJwksUrl: env.CF_ACCESS_TEST_JWKS_URL,
			adminAllowedEmails: env.ADMIN_ALLOWED_EMAILS.map((email) => email.toLowerCase())
		}
	};
}
