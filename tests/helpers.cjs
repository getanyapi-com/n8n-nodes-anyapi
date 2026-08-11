const { AnyApi } = require('../dist/nodes/AnyApi/AnyApi.node.js');

const flatOffer = { model: 'flat', unit: 'request', maxUsd: 0.00325 };
const linearOffer = {
	model: 'linear',
	unit: 'result',
	baseUsd: 0.00005,
	perUnitUsd: 0.0008,
	maxUsd: 0.04002,
};
const source = {
	id: 'silver-fox',
	name: 'Silver Fox',
	kind: 'anonymous',
	artworkKey: 'fox',
};
const health = {
	window: '30d',
	uptimePct: 99.8,
	latencyP50Ms: 420,
	uptimeSample: 900,
	latencySample: 810,
	requests: 950,
	servedRequests: 810,
};
const latency = {
	window: '30d',
	p50Ms: 500,
	p95Ms: 1200,
	p99Ms: 2400,
	sample: 810,
	basis: 'service_time_excludes_caller_requested_delay',
};

function apiFixture(overrides = {}) {
	return {
		id: 'api-1',
		slug: 'search.web',
		category: 'search',
		name: 'Web Search',
		description: 'Search the public web.',
		method: 'PUT',
		path: '/operations/search.web',
		provider: 'AnyAPI',
		execution: { mode: 'durable' },
		pricing: { from: linearOffer, failoverMaxUsd: 0.5 },
		lanes: [
			{ pricing: linearOffer, source, health },
			{
				pricing: flatOffer,
				source: {
					id: 'source-dataset',
					name: 'Source Dataset',
					kind: 'brand',
					artworkKey: 'dataset',
				},
			},
		],
		heavy: false,
		tryEligible: true,
		tryMaxItems: 3,
		failover: true,
		excludesCallerDelay: true,
		...overrides,
	};
}

function detailFixture(overrides = {}) {
	return apiFixture({
		inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
		outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
		latency,
		...overrides,
	});
}

function searchFixture(overrides = {}) {
	return {
		slug: 'search.web',
		platformId: 'search',
		name: 'Web Search',
		description: 'Search the public web.',
		category: 'search',
		method: 'POST',
		path: '/v1/run/search.web',
		provider: 'AnyAPI',
		execution: { mode: 'sync' },
		pricing: { from: flatOffer, failoverMaxUsd: 0.004 },
		failover: false,
		relevance: 0.93,
		...overrides,
	};
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

function assertCustomerSafe(assert, value) {
	if (Array.isArray(value)) {
		for (const item of value) assertCustomerSafe(assert, item);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value)) {
		assert.doesNotMatch(key, /credit/i);
		if (key === 'provider') assert.equal(nested, 'AnyAPI');
		assertCustomerSafe(assert, nested);
	}
}

module.exports = {
	AnyApi,
	apiFixture,
	assertCustomerSafe,
	detailFixture,
	execute,
	fakeContext,
	flatOffer,
	health,
	latency,
	linearOffer,
	searchFixture,
	source,
};
