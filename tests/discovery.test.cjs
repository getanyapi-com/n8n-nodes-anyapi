const assert = require('node:assert/strict');
const test = require('node:test');

const {
	AnyApi,
	apiFixture,
	assertCustomerSafe,
	detailFixture,
	execute,
	fakeContext,
	flatOffer,
	latency,
	linearOffer,
	searchFixture,
} = require('./helpers.cjs');

test('browse retains the exact authored operation, execution, pricing, lanes, sources, and health', async () => {
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
	assert.deepEqual(output[0][0].json.pricing.from, linearOffer);
	assert.deepEqual(
		output[0][0].json.lanes.map((lane) => lane.pricing),
		[linearOffer, flatOffer],
	);
	assert.equal(output[0][0].json.lanes[0].source.id, 'silver-fox');
	assert.deepEqual(output[0][0].json.lanes[0].health, api.lanes[0].health);
	assertCustomerSafe(assert, output);
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

test('ranked search retains lightweight facts, false failover, and true-or-absent caller delay', async () => {
	const ordinary = searchFixture({
		lanes: apiFixture().lanes,
		latency,
		futureResult: true,
	});
	const delayed = searchFixture({
		slug: 'search.delayed',
		path: '/v1/run/search.delayed',
		tryMaxItems: 8,
		failover: true,
		excludesCallerDelay: true,
		relevance: 0.8,
	});
	const response = {
		results: [ordinary, delayed],
		total: 2,
		ranking: 'semantic',
		futureEnvelope: true,
	};
	const { output, requests } = await execute(
		{
			operation: 'search',
			query: 'web results',
			searchFilters: { category: 'search', platform: 'search', limit: 12 },
		},
		response,
	);

	assert.deepEqual(requests[0].qs, {
		q: 'web results',
		category: 'search',
		platform: 'search',
		limit: 12,
	});
	const projected = output[0][0].json;
	assert.equal(projected.results[0].failover, false);
	assert.ok(!Object.hasOwn(projected.results[0], 'excludesCallerDelay'));
	assert.equal(projected.results[1].excludesCallerDelay, true);
	assert.equal(projected.results[1].tryMaxItems, 8);
	for (const result of projected.results) {
		assert.ok(!Object.hasOwn(result, 'lanes'));
		assert.ok(!Object.hasOwn(result, 'latency'));
	}
	assert.deepEqual(projected.results[0], searchFixture());
	assertCustomerSafe(assert, output);
});

test('ranked search remains rolling-safe when additive booleans and try limits are absent', async () => {
	const result = searchFixture();
	delete result.failover;
	const { output } = await execute(
		{ operation: 'search', query: 'web', searchFilters: {} },
		{ results: [result], total: 1, ranking: 'keyword' },
	);
	assert.ok(!Object.hasOwn(output[0][0].json.results[0], 'failover'));
	assert.ok(!Object.hasOwn(output[0][0].json.results[0], 'tryMaxItems'));
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

test('API dropdown labels headline pricing without reordering or comparing lanes', async () => {
	const response = {
		apis: [
			apiFixture({
				slug: 'flat.api',
				name: 'Flat API',
				pricing: { from: flatOffer, failoverMaxUsd: 0.5 },
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
			{ name: 'Flat API ($0.00325/request)', value: 'flat.api' },
			{
				name: 'Linear API ($0.00005/request + $0.0008/result, max $0.04002)',
				value: 'linear.api',
			},
		],
	);
});
