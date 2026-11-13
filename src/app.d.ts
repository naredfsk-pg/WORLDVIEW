// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AdminIdentity } from '#lib/types/views.js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Set by `hooks.server.ts` after Cloudflare Access verification on `/admin/*` (ARCHITECTURE §4). */
			admin?: AdminIdentity;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
