/**
 * Structured JSON logger: one line per record on stdout (`Logger` in `types/jobs.ts`).
 * Callers never pass secrets, env values or licensed article text.
 */
import type { JsonObject } from '#lib/types/domain.js';
import type { Logger } from '#lib/types/jobs.js';

export function createJsonLogger(
	write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
	now: () => Date = () => new Date()
): Logger {
	const log = (level: 'info' | 'warn' | 'error', message: string, fields: JsonObject = {}) =>
		write(JSON.stringify({ ts: now().toISOString(), level, msg: message, ...fields }));
	return {
		info: (message, fields) => log('info', message, fields),
		warn: (message, fields) => log('warn', message, fields),
		error: (message, fields) => log('error', message, fields)
	};
}
