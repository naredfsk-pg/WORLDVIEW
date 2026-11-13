import { expect, test } from '@playwright/test';

test('GET /health returns 200 with a reachable database', async ({ request }) => {
	const response = await request.get('/health');

	expect(response.status()).toBe(200);
	const body = await response.json();
	// `degraded` = data is stale (no successful ingest for 9 h), which is normal before the first ingest.
	expect(['ok', 'degraded']).toContain(body.status);
	expect(body).toMatchObject({ db: 'ok' });
	expect(typeof body.stale).toBe('boolean');
});
