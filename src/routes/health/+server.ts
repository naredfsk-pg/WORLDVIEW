import { json } from '@sveltejs/kit';
import { version } from '$app/env';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { HealthResponse } from '#lib/types/views.js';
import { computeFreshness } from '#lib/utils/freshness.js';
import { nowUtcIso } from '#lib/utils/date.js';
import type { RequestHandler } from './$types';

/**
 * `GET /health` (ARCHITECTURE §3): 200 `ok`; 200 `degraded` when data is stale (no successful
 * ingest for 9 h); 503 `error` when the database cannot be read. No auth, no secrets, no-store.
 */
export const GET: RequestHandler = async () => {
	const now = new Date();
	const headers = { 'cache-control': 'no-store' };

	let timestamps;
	try {
		const { read } = getRepositories();
		await read.ping();
		timestamps = await read.getFreshnessTimestamps();
	} catch (error) {
		// Log the error name only: driver messages can contain file paths.
		console.error(
			'[health] database check failed:',
			error instanceof Error ? error.name : 'unknown'
		);
		const body: HealthResponse = {
			status: 'error',
			db: 'error',
			stale: true,
			last_ingest_succeeded_at: null,
			last_brief_published_at: null,
			time: nowUtcIso(),
			version
		};
		return json(body, { status: 503, headers });
	}

	const freshness = computeFreshness(timestamps, now);
	const body: HealthResponse = {
		status: freshness.stale ? 'degraded' : 'ok',
		db: 'ok',
		stale: freshness.stale,
		last_ingest_succeeded_at: freshness.last_ingest_succeeded_at,
		last_brief_published_at: freshness.last_brief_published_at,
		time: now.toISOString(),
		version
	};
	return json(body, { status: 200, headers });
};
