import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { Repositories } from '#lib/types/repositories.js';
import { GET } from './+server';

vi.mock('#lib/server/db/repositories/index.js', () => ({ getRepositories: vi.fn() }));

type HealthEvent = Parameters<typeof GET>[0];
const callHealth = () => GET({} as HealthEvent);

const ping = vi.fn<() => Promise<void>>();
const getFreshnessTimestamps = vi.fn<Repositories['read']['getFreshnessTimestamps']>();

function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('GET /health', () => {
	beforeEach(() => {
		ping.mockReset().mockResolvedValue(undefined);
		getFreshnessTimestamps.mockReset();
		vi.mocked(getRepositories).mockReturnValue({
			read: { ping, getFreshnessTimestamps }
		} as unknown as Repositories);
	});

	it('returns 200 ok with freshness fields when data is fresh', async () => {
		const lastIngest = hoursAgo(1);
		getFreshnessTimestamps.mockResolvedValue({
			last_ingest_succeeded_at: lastIngest,
			last_brief_published_at: hoursAgo(2)
		});

		const response = await callHealth();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(body).toMatchObject({
			status: 'ok',
			db: 'ok',
			stale: false,
			last_ingest_succeeded_at: lastIngest
		});
		expect(new Date(body.time).toISOString()).toBe(body.time);
		expect(typeof body.version).toBe('string');
	});

	it('returns 200 degraded when the last successful ingest is 9 h old or missing', async () => {
		getFreshnessTimestamps.mockResolvedValue({
			last_ingest_succeeded_at: hoursAgo(10),
			last_brief_published_at: null
		});
		const stale = await callHealth();
		expect(stale.status).toBe(200);
		expect(await stale.json()).toMatchObject({ status: 'degraded', db: 'ok', stale: true });

		getFreshnessTimestamps.mockResolvedValue({
			last_ingest_succeeded_at: null,
			last_brief_published_at: null
		});
		const never = await callHealth();
		expect(await never.json()).toMatchObject({ status: 'degraded', stale: true });
	});

	it('returns 503 error when the database check fails', async () => {
		ping.mockRejectedValue(new Error('SQLITE_CANTOPEN: /secret/path/worldview.db'));

		const response = await callHealth();
		const text = await response.text();

		expect(response.status).toBe(503);
		expect(JSON.parse(text)).toMatchObject({ status: 'error', db: 'error' });
		expect(text).not.toContain('/secret/path');
	});

	it('exposes only the documented fields', async () => {
		getFreshnessTimestamps.mockResolvedValue({
			last_ingest_succeeded_at: null,
			last_brief_published_at: null
		});

		const body = await (await callHealth()).json();

		expect(Object.keys(body).sort()).toEqual([
			'db',
			'last_brief_published_at',
			'last_ingest_succeeded_at',
			'stale',
			'status',
			'time',
			'version'
		]);
	});
});
