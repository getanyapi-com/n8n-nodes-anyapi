const assert = require('node:assert/strict');

const { AnyApi } = require('../dist/nodes/AnyApi/AnyApi.node.js');
const { customerSafeDiscovery } = require('../dist/nodes/AnyApi/discovery.js');

const BASE_URL = 'https://api.getanyapi.com';
const RETRIES = 3;

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
	let lastError;
	for (let attempt = 1; attempt <= RETRIES; attempt++) {
		let response;
		try {
			response = await fetch(url, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			lastError = error;
			if (attempt < RETRIES) {
				await delay(250 * attempt);
				continue;
			}
			throw error;
		}

		if (response.ok) return response.json();
		const retryable = response.status === 429 || response.status >= 500;
		const message = `GET ${url} returned ${response.status}`;
		if (!retryable || attempt === RETRIES) throw new Error(message);
		lastError = new Error(message);
		await delay(250 * attempt);
	}
	throw lastError;
}

function requestUrl(request) {
	const url = new URL(request.url);
	for (const [key, value] of Object.entries(request.qs ?? {})) {
		url.searchParams.set(key, String(value));
	}
	return url;
}

async function readExchange(exchange) {
	const raw = await fetchJson(requestUrl(exchange.request));
	// Parsing is intentionally outside fetchJson's retry loop: a wire-contract
	// regression must fail immediately, not be mistaken for a transient outage.
	return exchange.read(raw);
}

async function main() {
	const catalogExchange = customerSafeDiscovery.catalog(BASE_URL);
	const apis = await readExchange(catalogExchange);
	assert.ok(apis.length > 0, 'catalog must contain at least one API');

	const tryApi = apis.find((api) => api.tryEligible === true);
	assert.ok(tryApi, 'catalog must contain a try-eligible API');
	const slug = String(tryApi.slug);

	// Exercise the public n8n load-options seam, not just its underlying reader.
	const node = new AnyApi();
	const dropdownOptions = await node.methods.loadOptions.getSkus.call({
		getCredentials: async () => ({ baseUrl: BASE_URL }),
		helpers: {
			httpRequest: async (request) => fetchJson(requestUrl(request)),
		},
	});
	assert.ok(dropdownOptions.length > 0, 'API dropdown must contain options');
	assert.ok(
		dropdownOptions.some((option) => option.value === slug),
		'API dropdown must include the selected try-eligible SKU',
	);

	const search = await readExchange(
		customerSafeDiscovery.search(BASE_URL, 'web', { limit: 1 }),
	);
	assert.ok(Array.isArray(search.results), 'search results must be an array');
	assert.ok(search.results.length > 0, 'search must return at least one result');

	const publicSchemaUrl = `${BASE_URL}/public/try/${encodeURIComponent(slug)}/schema`;
	const rawDetail = await fetchJson(publicSchemaUrl);
	const detail = customerSafeDiscovery.detail(BASE_URL, slug).read(rawDetail);
	assert.equal(detail.slug, slug, 'public schema detail must match the selected SKU');
	assert.ok(
		detail.inputSchema && typeof detail.inputSchema === 'object',
		'detail must contain an input schema object',
	);
	assert.ok(
		detail.outputSchema && typeof detail.outputSchema === 'object',
		'detail must contain an output schema object',
	);

	// Exercise Resource Mapper with the credentialless public schema response.
	const mapped = await node.methods.resourceMapping.getApiInputSchema.call({
		getCurrentNodeParameter: () => slug,
		getCredentials: async () => ({ baseUrl: BASE_URL }),
		helpers: {
			httpRequestWithAuthentication: async () => rawDetail,
		},
	});
	assert.ok(Array.isArray(mapped.fields), 'Resource Mapper must return a field array');

	console.log(
		`Live discovery canary passed (${apis.length} APIs, ${search.results.length} search result, ${slug}).`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
