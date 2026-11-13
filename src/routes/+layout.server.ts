import { error } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { LayoutData } from '#lib/types/views.js';
import { toBriefDate } from '#lib/utils/date.js';
import { computeFreshness } from '#lib/utils/freshness.js';
import type { LayoutServerLoad } from './$types';

/** Root layout (ARCHITECTURE §3): freshness, demo mode, today (Bangkok) and the public site URL. */
export const load: LayoutServerLoad = async ({ setHeaders }): Promise<LayoutData> => {
	let timestamps;
	let demoMode;
	try {
		const { read } = getRepositories();
		[timestamps, demoMode] = await Promise.all([
			read.getFreshnessTimestamps(),
			read.hasPublishedDemoContent()
		]);
	} catch (cause) {
		// Log the error name only: driver messages can contain file paths.
		console.error(
			'[layout] database read failed:',
			cause instanceof Error ? cause.name : 'unknown'
		);
		error(503, 'ระบบข้อมูลไม่พร้อมใช้งานชั่วคราว');
	}

	setHeaders({ 'cache-control': 'public, max-age=60' });
	const now = new Date();
	return {
		freshness: computeFreshness(timestamps, now),
		demo_mode: demoMode,
		today: toBriefDate(now.toISOString()),
		site_url: getConfig().app.publicSiteUrl
	};
};
