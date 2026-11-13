/**
 * axe-core helpers for a11y.e2e.ts and admin-a11y.e2e.ts. Serious and critical violations fail
 * the run, except nodes that match an open bug in KNOWN_A11Y_BUGS (docs/qa/BUGS.md); each open bug
 * has its own `test.fixme` that asserts it is gone, so fixing one means removing its entry and the
 * fixme.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

export interface KnownA11yBug {
	id: string;
	rule: string;
	/** A snippet of the offending element's HTML that identifies the node. */
	html: string;
}

/** Open known bugs. None: BUG-QA-001…004 were fixed in Wave 3 (regression tests in a11y.e2e.ts). */
export const KNOWN_A11Y_BUGS: Record<string, KnownA11yBug> = {};

export interface A11yNode {
	rule: string;
	impact: string;
	target: string;
	html: string;
}

/** All axe violations on the current page, one entry per node; the raw result is attached. */
export async function scanPage(page: Page, testInfo: TestInfo, label: string): Promise<A11yNode[]> {
	const results = await new AxeBuilder({ page }).analyze();
	await testInfo.attach(`axe ${label}`, {
		body: JSON.stringify(results.violations, null, 1),
		contentType: 'application/json'
	});
	return results.violations.flatMap((violation) =>
		violation.nodes.map((node) => ({
			rule: violation.id,
			impact: violation.impact ?? 'unknown',
			target: node.target.join(' '),
			html: node.html
		}))
	);
}

/** Serious/critical nodes that no known bug explains. */
export function unexpectedSerious(nodes: A11yNode[]): A11yNode[] {
	const known: KnownA11yBug[] = Object.values(KNOWN_A11Y_BUGS);
	return nodes.filter(
		(node) =>
			(node.impact === 'serious' || node.impact === 'critical') &&
			!known.some((bug) => bug.rule === node.rule && node.html.includes(bug.html))
	);
}

export function nodesOf(nodes: A11yNode[], bug: KnownA11yBug): A11yNode[] {
	return nodes.filter((node) => node.rule === bug.rule && node.html.includes(bug.html));
}
