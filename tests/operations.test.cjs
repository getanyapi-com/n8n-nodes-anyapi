const assert = require('node:assert/strict');
const test = require('node:test');

const {
	AnyApi,
	apiFixture,
	detailFixture,
	execute,
	searchFixture,
} = require('./helpers.cjs');

const terminal = {
	output: { found: true, data: { items: [{ id: 1 }] } },
	provider: 'AnyAPI',
	costUsd: 0.02,
	items: 1,
};

const operationCases = [
	{
		name: 'Run API',
		parameters: {
			operation: 'run',
			sku: 'search.web',
			inputMode: 'json',
			input: { query: 'n8n' },
			options: {},
		},
		response: terminal,
		method: 'POST',
		path: '/v1/run/search.web',
	},
	{
		name: 'Get API Schema',
		parameters: { operation: 'getSchema', sku: 'search.web' },
		response: detailFixture(),
		method: 'GET',
		path: '/v1/apis/search.web',
	},
	{
		name: 'Get Balance',
		parameters: { operation: 'getBalance' },
		response: { balanceUsd: 4.5 },
		method: 'GET',
		path: '/v1/balance',
	},
	{
		name: 'Get Request',
		parameters: { operation: 'getRequest', requestId: 'req/a' },
		response: { requestId: 'req/a', status: 'running' },
		method: 'GET',
		path: '/v1/requests/req%2Fa',
	},
	{
		name: 'List APIs',
		parameters: { operation: 'list', filters: { category: 'search' } },
		response: { apis: [apiFixture()] },
		method: 'GET',
		path: '/v1/apis',
	},
	{
		name: 'Search APIs',
		parameters: {
			operation: 'search',
			query: 'web',
			searchFilters: { category: 'search', platform: 'search', limit: 12 },
		},
		response: { results: [searchFixture()], total: 1, ranking: 'semantic' },
		method: 'GET',
		path: '/catalog/search',
	},
	{
		name: 'Wait for Request',
		parameters: { operation: 'waitRequest', requestId: 'req_123' },
		response: { requestId: 'req_123', status: 'succeeded', result: terminal },
		method: 'GET',
		path: '/v1/requests/req_123',
	},
];

test('all seven documented operations route through their executable node seam', async () => {
	const node = new AnyApi();
	const operationProperty = node.description.properties.find(({ name }) => name === 'operation');
	assert.deepEqual(
		operationProperty.options.map(({ name }) => name).sort(),
		operationCases.map(({ name }) => name).sort(),
	);

	for (const fixture of operationCases) {
		const { requests } = await execute(fixture.parameters, fixture.response);
		assert.equal(requests[0].method, fixture.method, fixture.name);
		assert.equal(new URL(requests[0].url).pathname, fixture.path, fixture.name);
	}
});

test('Max Items editor input is constrained to non-negative integers', () => {
	const node = new AnyApi();
	const options = node.description.properties.find(({ name }) => name === 'options');
	const maxItems = options.options.find(({ name }) => name === 'maxItems');
	assert.deepEqual(maxItems.typeOptions, { minValue: 0, numberPrecision: 0 });
});

test('Run API omits max_items when zero means unlimited', async () => {
	for (const maxItems of [0, '0']) {
		const { requests } = await execute(
			{
				operation: 'run',
				sku: 'search.web',
				inputMode: 'json',
				input: '{}',
				options: { maxItems },
			},
			terminal,
		);

		assert.deepEqual(requests[0].qs, {});
		assert.ok(!Object.hasOwn(requests[0].qs, 'max_items'));
	}
});

test('Run API coerces an integer expression string before outbound transport', async () => {
	const { requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'json',
			input: '{}',
			options: { maxItems: '5' },
		},
		terminal,
	);
	assert.equal(requests[0].qs.max_items, 5);
});

test('Run API rejects invalid Max Items before outbound transport', async () => {
	for (const maxItems of [
		-1,
		'-1',
		1.5,
		'1.5',
		Number.POSITIVE_INFINITY,
		'Infinity',
		'1e-324',
		'no limit',
	]) {
		const { output, requests } = await execute(
			{
				operation: 'run',
				sku: 'search.web',
				inputMode: 'json',
				input: '{}',
				options: { maxItems },
			},
			terminal,
			{ continueOnFail: true },
		);
		assert.equal(requests.length, 0);
		assert.match(output[0][0].json.error, /max items must be a non-negative integer/i);
	}
});

test('Run API sends positive response-budget options without changing the body', async () => {
	const { requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'json',
			input: { query: 'n8n' },
			options: { fields: 'url,title', maxItems: 5, summary: true },
		},
		terminal,
	);

	assert.deepEqual(requests[0].body, { query: 'n8n' });
	assert.deepEqual(requests[0].qs, {
		fields: 'url,title',
		max_items: 5,
		summary: true,
	});
	assert.match(requests[0].headers['Idempotency-Key'], /^n8n-[a-f0-9-]{36}$/);
});

test('Run API returns an accepted durable Request without repeating the paid POST', async () => {
	const accepted = { requestId: 'req_123', status: 'queued', retryAfterSeconds: 2 };
	const { output, requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'json',
			input: '{}',
			options: { returnImmediately: true },
		},
		accepted,
	);

	assert.deepEqual(output[0][0].json, accepted);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].headers.Prefer, 'respond-async');
});

test('separate Run API invocations never reuse an idempotency key', async () => {
	const parameters = {
		operation: 'run',
		sku: 'search.web',
		inputMode: 'json',
		input: '{}',
		options: { returnImmediately: true },
	};
	const accepted = { requestId: 'req_123', status: 'queued' };
	const first = await execute(parameters, accepted);
	const second = await execute(parameters, accepted);
	assert.notEqual(
		first.requests[0].headers['Idempotency-Key'],
		second.requests[0].headers['Idempotency-Key'],
	);
});

test('unknown operations fail before outbound transport instead of reading balance', async () => {
	const { output, requests } = await execute(
		{ operation: 'unknown' },
		{},
		{ continueOnFail: true },
	);
	assert.equal(requests.length, 0);
	assert.match(output[0][0].json.error, /unsupported anyapi operation/i);
});
