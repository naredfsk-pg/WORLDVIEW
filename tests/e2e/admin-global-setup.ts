/**
 * Playwright global setup: a fresh RSA key for this run, its public half served as a JWKS on
 * 127.0.0.1 (the e2e preview server fetches it lazily on the first admin request). The private
 * key only ever lives in this test process's environment.
 */
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair } from 'jose';
import { E2E_JWKS_PORT, E2E_KID, PRIVATE_JWK_ENV } from './admin-auth';

export default async function globalSetup(): Promise<() => Promise<void>> {
	const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
	const publicJwk = { ...(await exportJWK(publicKey)), kid: E2E_KID, alg: 'RS256', use: 'sig' };
	process.env[PRIVATE_JWK_ENV] = JSON.stringify(await exportJWK(privateKey));

	const server = createServer((request, response) => {
		if (request.url !== '/certs') {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ keys: [publicJwk] }));
	});
	await new Promise<void>((resolve) => server.listen(E2E_JWKS_PORT, '127.0.0.1', resolve));

	return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
