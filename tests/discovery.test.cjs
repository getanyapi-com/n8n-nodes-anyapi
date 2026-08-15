const assert = require('node:assert/strict');
const test = require('node:test');

const {
	AnyApi,
	apiFixture,
	assertCustomerSafe,
	clone,
	detailFixture,
	execute,
	fakeContext,
	flatOffer,
	golden,
	latency,
	linearOffer,
	searchFixture,
} = require('./helpers.cjs');

test('public browse, ranked-search, and detail execute seams read the shared V1 golden exactly', async () => {
	const browse = await execute(
		{ operation: 'list', filters: { category: 'data' } },
		clone(golden.rest.browse),
	);
	assert.deepEqual(browse.requests, [
		{
			method: 'GET',
			url: 'https://api.example.test/v1/apis',
			qs: { category: 'data' },
			json: true,
		},
	]);
	assert.deepEqual(
		browse.output[0].map(({ json }) => json),
		golden.rest.browse.apis,
	);

	const search = await execute(
		{
			operation: 'search',
			query: 'data',
			searchFilters: { category: 'data', platform: 'linear', limit: 2 },
		},
		clone(golden.rest.search),
	);
	assert.deepEqual(search.requests[0].qs, {
		q: 'data',
		category: 'data',
		platform: 'linear',
		limit: 2,
	});
	assert.deepEqual(search.output[0][0].json, golden.rest.search);

	for (const [slug, wire] of Object.entries(golden.rest.detail)) {
		const detail = await execute(
			{ operation: 'getSchema', sku: slug },
			clone(wire),
		);
		assert.equal(detail.requests[0].url, `https://api.example.test/v1/apis/${slug}`);
		assert.deepEqual(detail.output[0][0].json, wire);
	}
	assertCustomerSafe(assert, [browse.output, search.output, golden.rest.detail]);
});

test('browse accepts an empty authoritative lane plan and absent optional booleans', async () => {
	const api = apiFixture({ lanes: [] });
	delete api.failover;
	delete api.excludesCallerDelay;
	const { output } = await execute(
		{ operation: 'list', filters: {} },
		{ apis: [api] },
	);
	assert.deepEqual(output[0][0].json, api);
});

test('ranked search remains rolling-safe when additive booleans and try limits are absent', async () => {
	const result = searchFixture();
	delete result.failover;
	delete result.excludesCallerDelay;
	delete result.tryMaxItems;
	const { output } = await execute(
		{ operation: 'search', query: 'web', searchFilters: {} },
		{ results: [result], total: 1, ranking: 'keyword' },
	);
	assert.ok(!Object.hasOwn(output[0][0].json.results[0], 'failover'));
	assert.ok(!Object.hasOwn(output[0][0].json.results[0], 'excludesCallerDelay'));
	assert.ok(!Object.hasOwn(output[0][0].json.results[0], 'tryMaxItems'));
});

test('browse and ranked search ignore cloned safe additive fields', async () => {
	const browse = clone(golden.rest.browse);
	browse.futureEnvelopeField = true;
	browse.apis[0].futureApiField = true;
	browse.apis[0].pricing.futurePricingField = true;
	browse.apis[0].lanes[0].futureLaneField = true;
	browse.apis[0].lanes[0].pricing.futureOfferField = true;
	browse.apis[0].lanes[0].source.futureSourceField = true;
	browse.apis[0].lanes[0].health.futureHealthField = true;
	const browsed = await execute({ operation: 'list', filters: {} }, browse);
	assert.deepEqual(
		browsed.output[0].map(({ json }) => json),
		golden.rest.browse.apis,
	);

	const search = clone(golden.rest.search);
	search.futureEnvelopeField = true;
	search.results[0].futureResultField = true;
	search.results[0].pricing.futurePricingField = true;
	search.results[0].lanes = clone(golden.rest.browse.apis[0].lanes);
	search.results[0].latency = clone(golden.rest.detail['linear.data'].latency);
	const searched = await execute(
		{ operation: 'search', query: 'data', searchFilters: {} },
		search,
	);
	assert.deepEqual(searched.output[0][0].json, golden.rest.search);
});

test('ranked search rejects a false caller-delay flag instead of inventing false semantics', async () => {
	const { output } = await execute(
		{ operation: 'search', query: 'web', searchFilters: {} },
		{
			results: [searchFixture({ excludesCallerDelay: false })],
			total: 1,
			ranking: 'keyword',
		},
		{ continueOnFail: true },
	);
	assert.match(output[0][0].json.error, /expected true or an absent field/i);
});

test('detail retains populated, null, and rolling-safe absent latency exactly', async () => {
	for (const [name, value] of [
		['populated', latency],
		['null', null],
		['absent', undefined],
	]) {
		const detail = detailFixture({ latency: value });
		const { output } = await execute(
			{ operation: 'getSchema', sku: detail.slug },
			detail,
		);
		const projected = output[0][0].json;
		if (name === 'absent') assert.ok(!Object.hasOwn(projected, 'latency'));
		else assert.deepEqual(projected.latency, value);
	}
});

test('detail rejects latency without a positive sample and the exact service-time basis', async () => {
	for (const [field, value, message] of [
		['sample', 0, /detail\.latency\.sample.*positive integer/i],
		['basis', 'end_to_end', /detail\.latency\.basis.*service_time_excludes/i],
	]) {
		const detail = detailFixture({ latency: { ...latency, [field]: value } });
		const { output } = await execute(
			{ operation: 'getSchema', sku: detail.slug },
			detail,
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, message);
	}
});

test('detail preserves JSON Schemas opaquely while dropping safe additive DTO fields', async () => {
	const inputSchema = {
		type: 'object',
		'x-future-keyword': { nested: [1, { ok: true }] },
		properties: { query: { type: 'string', futureKeyword: true } },
	};
	const outputSchema = {
		type: 'object',
		properties: { data: { type: 'object', unevaluatedProperties: true } },
	};
	const detail = detailFixture({ inputSchema, outputSchema, futureApiField: true });
	const { output } = await execute(
		{ operation: 'getSchema', sku: detail.slug },
		detail,
	);
	assert.deepEqual(output[0][0].json.inputSchema, inputSchema);
	assert.deepEqual(output[0][0].json.outputSchema, outputSchema);
	assert.ok(!Object.hasOwn(output[0][0].json, 'futureApiField'));
});

test('detail rejects missing or malformed required schema objects', async () => {
	for (const override of [{ outputSchema: undefined }, { outputSchema: [] }]) {
		const detail = detailFixture(override);
		const { output } = await execute(
			{ operation: 'getSchema', sku: detail.slug },
			detail,
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, /detail\.outputSchema.*expected an object/i);
	}
});

test('discovery rejects internal accounting and upstream provider data before projection', async () => {
	for (const forbidden of [
		{ future: { CreditBalance: 2 } },
		{ future: { provider: 'upstream-provider' } },
		{ inputSchema: { type: 'object', future: { provider: 'upstream' } } },
	]) {
		const detail = detailFixture(forbidden);
		const { output } = await execute(
			{ operation: 'getSchema', sku: detail.slug },
			detail,
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, /customer-safe discovery contract/i);
	}
});

test('discovery rejects malformed authored operation, execution, and pricing facts', async () => {
	for (const override of [
		{ method: 1 },
		{ execution: { mode: 'eventually' } },
		{ pricing: { from: { model: 'tiered', unit: 'request', maxUsd: 1 }, failoverMaxUsd: 1 } },
		{ pricing: { from: flatOffer, failoverMaxUsd: -1 } },
	]) {
		const api = apiFixture(override);
		const { output } = await execute(
			{ operation: 'list', filters: {} },
			{ apis: [api] },
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, /customer-safe discovery contract/i);
	}
});

test('API dropdown quotes the published per-1k rate without reordering or comparing lanes', async () => {
	const response = {
		apis: [
			apiFixture({
				slug: 'flat.api',
				name: 'Flat API',
				pricing: { from: flatOffer, failoverMaxUsd: 0.5, failoverMaxPer1kUsd: 500 },
				lanes: [{ ...apiFixture().lanes[0], pricing: linearOffer }],
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
			{ name: 'Flat API ($5.00/1k req)', value: 'flat.api' },
			{
				name: 'Linear API ($0.0005/result, max $6.00/1k req)',
				value: 'linear.api',
			},
		],
	);
});

test('per-1k rates are read from the wire, never scaled from the per-request figure', async () => {
	const pricing = {
		from: { model: 'flat', unit: 'request', maxUsd: 0.0966, maxPer1kUsd: 96.6 },
		failoverMaxUsd: 0.0966,
		failoverMaxPer1kUsd: 96.6,
	};
	const api = apiFixture({ slug: 'metered.api', name: 'Metered API', pricing, lanes: [] });

	const { output } = await execute({ operation: 'list', filters: {} }, { apis: [api] });
	const projected = output[0][0].json.pricing;
	assert.notEqual(0.0966 * 1000, 96.6);
	assert.equal(projected.from.maxPer1kUsd, 96.6);
	assert.equal(projected.failoverMaxPer1kUsd, 96.6);
	assert.equal(projected.from.maxUsd, 0.0966);

	const node = new AnyApi();
	const { ctx } = fakeContext({}, { apis: [api] });
	const [option] = await node.methods.loadOptions.getSkus.call(ctx);
	assert.equal(option.name, 'Metered API ($96.60/1k req)');
});

test('discovery rejects an offer or failover ceiling published without its per-1k rate', async () => {
	for (const [override, message] of [
		[
			{ pricing: { from: { ...flatOffer, maxPer1kUsd: undefined }, failoverMaxUsd: 0.005, failoverMaxPer1kUsd: 5 } },
			/pricing\.from\.maxPer1kUsd.*finite number/i,
		],
		[
			{ pricing: { from: flatOffer, failoverMaxUsd: 0.005 } },
			/pricing\.failoverMaxPer1kUsd.*finite number/i,
		],
	]) {
		const { output } = await execute(
			{ operation: 'list', filters: {} },
			{ apis: [apiFixture(override)] },
			{ continueOnFail: true },
		);
		assert.match(output[0][0].json.error, message);
	}
});
