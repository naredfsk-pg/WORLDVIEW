/**
 * Error text that is safe to log or store (`handleError` logs, `job_runs.error`, job logs).
 *
 * Drizzle wraps driver errors and puts the SQL text, and for `DrizzleQueryError` the bound
 * params (excerpts, LLM output, …), into the message, so query errors keep only their names and
 * the driver's error code. Other errors keep `name: message` on one line with file paths
 * redacted. Never the stack.
 */
import { DrizzleError, DrizzleQueryError } from 'drizzle-orm/errors';

/**
 * Only this much of the one-line message is checked for SQL: the pattern backtracks
 * quadratically on long text, and the output is a few hundred characters of that same prefix.
 */
const SQL_SCAN_LENGTH = 2000;

/** One line, at most `maxLength` characters. */
export function sanitizeErrorMessage(error: unknown, maxLength: number): string {
	if (!(error instanceof Error)) return 'unknown error';
	const line = `${error.name}: ${error.message}`.replace(/\s+/g, ' ');
	const isQueryError = error instanceof DrizzleQueryError || error instanceof DrizzleError;
	if (isQueryError || SQL_LIKE.test(line.slice(0, SQL_SCAN_LENGTH))) {
		// `DrizzleQueryError` does not set `name` (it stays "Error").
		const name = error instanceof DrizzleQueryError ? 'DrizzleQueryError' : error.name;
		const cause = error.cause instanceof Error ? error.cause : null;
		const code = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : null;
		return [name, cause?.name, code].filter(Boolean).join(': ') + ' [query redacted]';
	}
	return line.replace(/(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/g, '[path]').slice(0, maxLength);
}

/** A statement keyword followed by its clause, or a bound-parameter dump. */
const SQL_LIKE =
	/\b(?:select|insert|update|delete|replace|pragma|create|drop|alter)\b[\s\S]*\b(?:from|into|set|table|where|values)\b|\bparams:/i;
