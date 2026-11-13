import type { Page } from '@playwright/test';

export interface FirstTheme {
	theme: string;
	/** Set while `<body>` did not exist yet: by the head script, before first paint (no flash). */
	beforeBody: boolean;
}

export interface CspWatch {
	/** Every violation so far, from the `securitypolicyviolation` event and Chrome's console. */
	violations: string[];
	/** How the current document's `data-theme` was first set, or null if it never was. */
	firstTheme(): Promise<FirstTheme | null>;
}

type WatchedWindow = Window & {
	__reportCspViolation?: (violation: string) => void;
	__firstTheme?: FirstTheme;
};

/**
 * Watches a page for CSP violations across navigations. Init scripts and exposed functions run
 * outside the page's CSP, so the watcher itself cannot cause or hide a violation.
 */
export async function watchCsp(page: Page): Promise<CspWatch> {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /content security policy/i.test(message.text())) {
			violations.push(`console: ${message.text()}`);
		}
	});
	await page.exposeFunction('__reportCspViolation', (violation: string) => {
		violations.push(violation);
	});
	await page.addInitScript(() => {
		const watched = window as WatchedWindow;
		document.addEventListener('securitypolicyviolation', (event) => {
			const where = `${event.sourceFile || location.pathname}:${event.lineNumber}`;
			watched.__reportCspViolation?.(
				`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'} at ${where}`
			);
		});

		const observer = new MutationObserver(() => {
			const theme = document.documentElement.getAttribute('data-theme');
			if (theme === null || watched.__firstTheme) return;
			watched.__firstTheme = { theme, beforeBody: document.body === null };
			observer.disconnect();
		});
		observer.observe(document, {
			subtree: true,
			attributes: true,
			attributeFilter: ['data-theme']
		});
	});

	return {
		violations,
		firstTheme: () => page.evaluate(() => (window as WatchedWindow).__firstTheme ?? null)
	};
}
