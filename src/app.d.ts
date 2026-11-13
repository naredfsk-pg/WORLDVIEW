// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AdminIdentity } from '#lib/types/views.js';

declare global {
	namespace App {
		interface Error {
			/** Set by `handleError` for unexpected errors; also written to the server log. */
			error_id?: string;
		}
		interface Locals {
			/** Set by `hooks.server.ts` after Cloudflare Access verification on `/admin/*` (ARCHITECTURE §4). */
			admin?: AdminIdentity;
			/** True only for the `vite dev` bypass (no CF_ACCESS_AUD): the admin layout shows a banner. */
			adminDevBypass?: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
