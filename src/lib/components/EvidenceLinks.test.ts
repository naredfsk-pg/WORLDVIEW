import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import EvidenceLinks from './EvidenceLinks.svelte';

describe('EvidenceLinks', () => {
	it('shows each evidence URL once, so duplicate refs cannot create duplicate keys', () => {
		const url = 'https://example.com/demo/a';
		const { body } = render(EvidenceLinks, {
			props: { urls: [url, url, 'https://example.com/demo/b', url] }
		});
		expect(body.match(/<a /g)).toHaveLength(2);
		expect(body).toContain('หลักฐาน 1');
		expect(body).toContain('หลักฐาน 2');
		expect(body).not.toContain('หลักฐาน 3');
	});

	it('renders non-http(s) URLs as text, never as a link', () => {
		const { body } = render(EvidenceLinks, {
			props: { urls: ['javascript:alert(1)', 'https://example.com/ok'] }
		});
		expect(body).not.toContain('javascript:');
		expect(body.match(/<a /g)).toHaveLength(1);
		expect(body).toContain('rel="external noopener noreferrer"');
	});
});
