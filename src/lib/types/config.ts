/**
 * Config contract: the set of env var NAMES. Values never appear in code, logs or docs.
 *
 * The runtime config object is owned by `src/lib/server/config.ts` (`getConfig()` / `parseConfig(env)`,
 * Zod-validated, reads `process.env` so CLI scripts work too). Its inferred `AppConfig` type is the
 * single source of truth for the config shape; this file intentionally does not redeclare it.
 * See ARCHITECTURE §14 for type, default and reader of every variable.
 */

export const ENV_VAR_NAMES = [
	'NODE_ENV',
	// LLM (omniroute, OpenAI-compatible). LLM_BASE_URL / LLM_API_KEY win; OMNI_* are the aliases set in .env.
	'OMNI_API_URL',
	'OMNI_API_KEY',
	'LLM_BASE_URL',
	'LLM_API_KEY',
	'LLM_API_COMPATIBILITY',
	'LLM_MODEL_ID',
	'LLM_MODEL_TAGGING',
	'LLM_MODEL_CLUSTERING',
	'LLM_MODEL_EXTRACTION',
	'LLM_MODEL_SUMMARY',
	'LLM_MODEL_RELATIONS',
	/** Added by the architecture contract (not yet in .env); defaults to LLM_MODEL_ID. */
	'LLM_MODEL_ACADEMY_LINKING',
	'LLM_MODEL_FALLBACK',
	'LLM_MODEL_FALLBACK_SECONDARY',
	'LLM_OMIT_TEMPERATURE_FOR',
	'LLM_TIMEOUT_SECONDS',
	'LLM_MAX_CONCURRENCY',
	'LLM_MAX_RETRIES',
	'LLM_MAX_INPUT_TOKENS',
	'LLM_MAX_OUTPUT_TOKENS',
	'LLM_TEMPERATURE',
	'LLM_DAILY_MAX_REQUESTS',
	'LLM_DAILY_MAX_TOKENS',
	// App
	'APP_TIMEZONE',
	'DATABASE_URL',
	'DAILY_EVENT_TARGET_MIN',
	'DAILY_EVENT_TARGET_MAX',
	'PUBLIC_SITE_URL',
	// Admin auth (Cloudflare Access)
	'CF_ACCESS_TEAM_DOMAIN',
	'CF_ACCESS_AUD',
	'ADMIN_ALLOWED_EMAILS',
	// Runtime / deploy (consumed by adapter-node, docker compose or cloudflared)
	'ORIGIN',
	'HOST',
	'PORT',
	'ADDRESS_HEADER',
	'BODY_SIZE_LIMIT',
	'PUBLIC_HOSTNAME',
	'COMPOSE_PROJECT_NAME',
	'TUNNEL_TOKEN'
] as const;
export type EnvVarName = (typeof ENV_VAR_NAMES)[number];
