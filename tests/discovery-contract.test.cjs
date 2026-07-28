const assert = require('node:assert/strict');
const test = require('node:test');

const { AnyApi } = require('../dist/nodes/AnyApi/AnyApi.node.js');

const flatOffer = { model: 'flat', unit: 'request', maxUsd: 0.00325 };
const linearOffer = {
	model: 'linear',
	unit: 'result',
	baseUsd: 0.00005,
	perUnitUsd: 0.0008,
	maxUsd: 0.04002,
};

function apiFixture(overrides = {}) {
	return {
		id: 'api-1',
		slug: 'search.web',
		category: 'search',
		name: 'Web Search',
		description: 'Search the public web.',
		provider: 'AnyAPI',
		pricing: { from: linearOffer, failoverMaxUsd: 0.04002 },
		lanes: [
			{
				pricing: linearOffer,
				health: { window: '30d', uptimePct: 99.8, latencyP50Ms: 420, requests: 810 },
			},
		],
		heavy: false,
		tryEligible: true,
		failover: false,
		excludesCallerDelay: true,
		...overrides,
	};
}

function detailFixture(overrides = {}) {
	return apiFixture({
		inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
		outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
		...overrides,
	});
}

function fakeContext(parameters, response, { continueOnFail = false } = {}) {
	const requests = [];
	const ctx = {
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ baseUrl: 'https://api.example.test/' }),
		getInputData: () => [{ json: {} }],
		getNode: () => ({ name: 'AnyAPI', type: 'anyApi' }),
		getNodeParameter(name, _index, fallback) {
			return Object.hasOwn(parameters, name) ? parameters[name] : fallback;
		},
		helpers: {
			async httpRequest(request) {
				requests.push(request);
				return typeof response === 'function' ? response(request) : response;
			},
			async httpRequestWithAuthentication(_credential, request) {
				requests.push(request);
				return typeof response === 'function' ? response(request) : response;
			},
		},
	};
	return { ctx, requests };
}

async function execute(parameters, response, options) {
	const node = new AnyApi();
	const { ctx, requests } = fakeContext(parameters, response, options);
	const output = await node.execute.call(ctx);
	return { output, requests };
}

function assertCustomerSafe(value) {
	if (Array.isArray(value)) {
		for (const item of value) assertCustomerSafe(item);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value)) {
		assert.doesNotMatch(key, /credit/i);
		if (key === 'provider') assert.equal(nested, 'AnyAPI');
		assertCustomerSafe(nested);
	}
}

test('List APIs browses by category and preserves nested USD discovery facts', async () => {
	const api = apiFixture();
	const { output, requests } = await execute(
		{ operation: 'list', filters: { category: 'search' } },
		{ apis: [api], futureEnvelopeField: true },
	);

	assert.deepEqual(requests, [
		{
			method: 'GET',
			url: 'https://api.example.test/v1/apis',
			qs: { category: 'search' },
			json: true,
		},
	]);
	assert.deepEqual(output[0][0].json, api);
	assertCustomerSafe(output);
});

test('Search APIs owns ranked queries and returns the search envelope', async () => {
	const search = {
		results: [
			{
				slug: 'search.web',
				platformId: 'search',
				name: 'Web Search',
				description: 'Search the public web.',
				category: 'search',
				provider: 'AnyAPI',
				pricing: { from: flatOffer, failoverMaxUsd: 0.004 },
				relevance: 0.93,
				highlightFields: [
					{ path: 'items[].url', type: 'string', why: 'The matched URL.' },
				],
			},
		],
		total: 1,
		ranking: 'semantic',
	};
	const { output, requests } = await execute(
		{
			operation: 'search',
			query: 'web results',
			searchFilters: { category: 'search', platform: 'search', limit: 12 },
		},
		search,
	);

	assert.deepEqual(requests, [
		{
			method: 'GET',
			url: 'https://api.example.test/catalog/search',
			qs: { q: 'web results', category: 'search', platform: 'search', limit: 12 },
			json: true,
		},
	]);
	assert.deepEqual(output[0][0].json, search);
	assertCustomerSafe(output);
});

test('Get API Schema returns detail schemas with canonical pricing unchanged', async () => {
	const api = detailFixture();
	const { output, requests } = await execute({ operation: 'getSchema', sku: api.slug }, api);

	assert.equal(requests[0].url, 'https://api.example.test/v1/apis/search.web');
	assert.deepEqual(output[0][0].json, api);
	assertCustomerSafe(output);
});

test('Get API Schema rejects detail without an output schema object', async () => {
	const malformed = apiFixture({ inputSchema: { type: 'object' } });
	const { output } = await execute(
		{ operation: 'getSchema', sku: malformed.slug },
		malformed,
		{ continueOnFail: true },
	);

	assert.match(output[0][0].json.error, /detail\.outputSchema.*expected an object/i);
});

test('Get API Schema rejects detail schemas with the wrong JSON type', async () => {
	const malformed = detailFixture({ outputSchema: [] });
	const { output } = await execute(
		{ operation: 'getSchema', sku: malformed.slug },
		malformed,
		{ continueOnFail: true },
	);

	assert.match(output[0][0].json.error, /detail\.outputSchema.*expected an object/i);
});

test('Input resource mapping rejects detail without an input schema instead of using empty fields', async () => {
	const malformed = apiFixture({ outputSchema: { type: 'object' } });
	const node = new AnyApi();
	const { ctx } = fakeContext({}, malformed);
	ctx.getCurrentNodeParameter = () => malformed.slug;

	await assert.rejects(
		() => node.methods.resourceMapping.getApiInputSchema.call(ctx),
		/detail\.inputSchema.*expected an object/i,
	);
});

test('Discovery operations reject legacy credit and upstream-provider payloads', async () => {
	const legacy = {
		slug: 'search.web',
		provider: 'upstream-provider',
		fromCredits: 325,
		inputSchema: { type: 'object' },
	};
	const { output } = await execute(
		{ operation: 'getSchema', sku: 'search.web' },
		legacy,
		{ continueOnFail: true },
	);

	assert.match(output[0][0].json.error, /customer-safe discovery contract/i);
});

test('Discovery accepts gateway-owned pricing, failover, lane, and health facts without deriving them', async () => {
	const inconsistent = detailFixture({
		pricing: { from: flatOffer, failoverMaxUsd: 0.001 },
		lanes: [
			{
				pricing: linearOffer,
				health: { window: '7d', uptimePct: 101, latencyP50Ms: -1, requests: -2 },
			},
			{ pricing: { model: 'flat', unit: 'item', maxUsd: 0.5 } },
		],
		failover: false,
	});
	const { output } = await execute(
		{ operation: 'getSchema', sku: 'search.web' },
		inconsistent,
	);

	assert.deepEqual(output[0][0].json, inconsistent);
});

test('Discovery accepts an empty authoritative lane list', async () => {
	const api = apiFixture({
		lanes: [],
		failover: true,
	});
	const { output } = await execute(
		{ operation: 'list', filters: {} },
		{ apis: [api] },
	);

	assert.deepEqual(output[0][0].json, api);
});

test('Browse permits omitted schemas but rejects malformed optional schemas', async () => {
	const malformed = apiFixture({ inputSchema: [] });
	const { output } = await execute(
		{ operation: 'list', filters: {} },
		{ apis: [malformed] },
		{ continueOnFail: true },
	);

	assert.match(output[0][0].json.error, /browse\.apis\[0\]\.inputSchema.*expected an object/i);
});

test('Discovery drops safe additive fields while preserving JSON Schemas as opaque objects', async () => {
	const inputSchema = {
		type: 'object',
		'x-future-keyword': { arbitrary: ['nested', { value: 1 }] },
		properties: { query: { type: 'string', futureSchemaKeyword: true } },
	};
	const outputSchema = {
		type: 'object',
		properties: { data: { type: 'object', unevaluatedProperties: true } },
	};
	const extended = detailFixture({
		inputSchema,
		outputSchema,
		futureApiField: { enabled: true },
		pricing: {
			from: { ...linearOffer, futureOfferField: 'ignored' },
			failoverMaxUsd: 7,
			futurePricingField: true,
		},
		lanes: [
			{
				pricing: { ...flatOffer, futureOfferField: 'ignored' },
				health: {
					window: 'rolling',
					uptimePct: 99,
					latencyP50Ms: 1,
					requests: 2,
					futureHealthField: 'ignored',
				},
				futureLaneField: true,
			},
		],
	});
	const { output } = await execute(
		{ operation: 'getSchema', sku: extended.slug },
		extended,
	);

	assert.deepEqual(output[0][0].json, {
		...detailFixture(),
		inputSchema,
		outputSchema,
		pricing: { from: linearOffer, failoverMaxUsd: 7 },
		lanes: [
			{
				pricing: flatOffer,
				health: { window: 'rolling', uptimePct: 99, latencyP50Ms: 1, requests: 2 },
			},
		],
	});
});

test('Search ignores additive envelope, result, highlight, pricing, and offer fields', async () => {
	const response = {
		results: [
			{
				slug: 'search.web',
				platformId: 'search',
				name: 'Web Search',
				description: 'Search the public web.',
				category: 'search',
				provider: 'AnyAPI',
				pricing: {
					from: { ...flatOffer, futureOffer: true },
					failoverMaxUsd: 0,
					futurePricing: true,
				},
				relevance: 4,
				highlightFields: [
					{
						path: 'items[].url',
						type: 'string',
						why: 'Match',
						futureHighlight: true,
					},
				],
				futureResult: true,
			},
		],
		total: 1,
		ranking: 'semantic',
		futureEnvelope: true,
	};
	const { output } = await execute(
		{ operation: 'search', query: 'web', searchFilters: {} },
		response,
	);

	assert.deepEqual(output[0][0].json, {
		results: [
			{
				slug: 'search.web',
				platformId: 'search',
				name: 'Web Search',
				description: 'Search the public web.',
				category: 'search',
				provider: 'AnyAPI',
				pricing: { from: flatOffer, failoverMaxUsd: 0 },
				relevance: 4,
				highlightFields: [{ path: 'items[].url', type: 'string', why: 'Match' }],
			},
		],
		total: 1,
		ranking: 'semantic',
	});
});

test('Discovery accepts older payloads without optional adapter booleans', async () => {
	const older = apiFixture();
	delete older.failover;
	delete older.excludesCallerDelay;
	const { output } = await execute(
		{ operation: 'list', filters: {} },
		{ apis: [older] },
	);

	assert.deepEqual(output[0][0].json, older);
});

test('API dropdown formats complete flat and linear USD offers', async () => {
	const response = {
		apis: [
			apiFixture({
				slug: 'flat.api',
				name: 'Flat API',
				pricing: { from: flatOffer, failoverMaxUsd: flatOffer.maxUsd },
				lanes: [{ pricing: flatOffer }],
			}),
			apiFixture({ slug: 'linear.api', name: 'Linear API' }),
		],
	};
	const node = new AnyApi();
	const { ctx } = fakeContext({}, response);
	const options = await node.methods.loadOptions.getSkus.call(ctx);

	assert.deepEqual(
		options.map(({ name, value }) => ({ name, value })),
		[
			{ name: 'Flat API ($0.00325/request)', value: 'flat.api' },
			{
				name: 'Linear API ($0.00005/request + $0.0008/result, max $0.04002)',
				value: 'linear.api',
			},
		],
	);
});

test('API dropdown uses pricing.from and does not compare mixed failover lanes', async () => {
	const inconsistent = apiFixture({
		pricing: { from: flatOffer, failoverMaxUsd: flatOffer.maxUsd },
		lanes: [{ pricing: flatOffer }, { pricing: linearOffer }],
	});
	const node = new AnyApi();
	const { ctx } = fakeContext({}, { apis: [inconsistent] });

	const options = await node.methods.loadOptions.getSkus.call(ctx);
	assert.equal(options[0].name, 'Web Search ($0.00325/request)');
});

test('Discovery rejects malformed pricing discriminants and negative USD scalars', async () => {
	for (const pricing of [
		{ from: { model: 'tiered', unit: 'request', maxUsd: 1 }, failoverMaxUsd: 1 },
		{ from: { model: 'flat', unit: 'request', maxUsd: -1 }, failoverMaxUsd: 1 },
		{ from: flatOffer, failoverMaxUsd: -1 },
	]) {
		const malformed = apiFixture({ pricing });
		const { output } = await execute(
			{ operation: 'list', filters: {} },
			{ apis: [malformed] },
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, /customer-safe discovery contract/i);
	}
});

test('Discovery scans ignored fields and schemas before projection', async () => {
	for (const forbidden of [
		{ future: { CreditBalance: 2 } },
		{ future: { provider: 'upstream-provider' } },
		{ inputSchema: { type: 'object', properties: { provider: { provider: 'upstream' } } } },
	]) {
		const malformed = detailFixture(forbidden);
		const { output } = await execute(
			{ operation: 'getSchema', sku: malformed.slug },
			malformed,
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, /customer-safe discovery contract/i);
	}
});

test('Node UI keeps browse category-only and exposes a dedicated search operation', () => {
	const node = new AnyApi();
	const operations = node.description.properties.find(({ name }) => name === 'operation');
	const listFilters = node.description.properties.find(({ name }) => name === 'filters');

	assert.ok(operations.options.some(({ value }) => value === 'search'));
	assert.deepEqual(listFilters.options.map(({ name }) => name), ['category']);
});
