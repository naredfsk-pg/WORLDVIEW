/**
 * Repository entry points (ARCHITECTURE §12):
 * - `getRepositories()` for routes (process-wide `getDb()`, memoized)
 * - `createRepositories(db)` for scripts and tests (`openDb(':memory:')` + migrations)
 */
import type { Repositories } from '../../../types/repositories';
import { getDb, type Db } from '../client';
import { createAcademyCatalogRepository } from './academy';
import { createAdminRepository } from './admin';
import { createBriefRepository } from './briefs';
import { createDigestRepository } from './digest';
import { createIngestRepository } from './ingest';
import { createJobRunRepository } from './job-runs';
import { createLlmCallRepository } from './llm-calls';
import { createPublicReadRepository } from './public-read';

export { EntityNotFoundError } from './shared';

let sharedRepositories: Repositories | undefined;

export function getRepositories(): Repositories {
	sharedRepositories ??= createRepositories(getDb());
	return sharedRepositories;
}

export function createRepositories(db: Db): Repositories {
	return {
		read: createPublicReadRepository(db),
		ingest: createIngestRepository(db),
		digest: createDigestRepository(db),
		briefs: createBriefRepository(db),
		jobs: createJobRunRepository(db),
		llmCalls: createLlmCallRepository(db),
		academy: createAcademyCatalogRepository(db),
		admin: createAdminRepository(db)
	};
}
