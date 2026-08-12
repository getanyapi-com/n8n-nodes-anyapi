const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { AnyApi } = require('../dist/nodes/AnyApi/AnyApi.node.js');

const goldenPath = join(__dirname, '..', 'testdata', 'discovery-v1.json');
const provenancePath = join(__dirname, '..', 'testdata', 'discovery-v1.provenance.json');
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

function clone(value) {
	return structuredClone(value);
}

function withOverrides(value, overrides) {
	return Object.assign(clone(value), overrides);
}

const browseApi = golden.rest.browse.apis.find(({ slug }) => slug === 'linear.data');
const detailApi = golden.rest.detail['linear.data'];
const searchResult = golden.rest.search.results.find(({ slug }) => slug === 'linear.data');
const flatOffer = clone(golden.rest.detail['flat.data'].pricing.from);
const linearOffer = clone(detailApi.pricing.from);
const latency = clone(detailApi.latency);

function apiFixture(overrides = {}) {
	return withOverrides(browseApi, overrides);
}

function detailFixture(overrides = {}) {
	return withOverrides(detailApi, overrides);
}

function searchFixture(overrides = {}) {
	return withOverrides(searchResult, overrides);
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
	clone,
	detailFixture,
	execute,
	fakeContext,
	flatOffer,
	golden,
	goldenPath,
	latency,
	linearOffer,
	provenancePath,
	searchFixture,
};
