const assert = require('node:assert/strict');
const test = require('node:test');

const { AnyApi, detailFixture, execute, fakeContext } = require('./helpers.cjs');

const inputSchema = {
	type: 'object',
	required: ['query'],
	properties: {
		query: { type: 'string' },
		count: { type: 'integer' },
		enabled: { type: 'boolean' },
		mode: { type: 'integer', enum: [1, 2] },
		filters: { type: 'object' },
		items: { type: 'array' },
		choice: { type: ['string', 'object', 'null'] },
		nothing: { type: 'null' },
	},
};

async function mappedFields() {
	const node = new AnyApi();
	const detail = detailFixture({ inputSchema });
	const { ctx } = fakeContext({}, detail);
	ctx.getCurrentNodeParameter = () => detail.slug;
	return node.methods.resourceMapping.getApiInputSchema.call(ctx);
}

test('schema codec keeps scalar and enum controls native and uses JSON controls for structured values', async () => {
	const { fields } = await mappedFields();
	const byId = Object.fromEntries(fields.map((field) => [field.id, field]));

	assert.equal(byId.query.type, 'string');
	assert.equal(byId.query.required, true);
	assert.equal(byId.count.type, 'number');
	assert.equal(byId.enabled.type, 'boolean');
	assert.equal(byId.filters.type, 'object');
	assert.equal(byId.items.type, 'array');
	assert.equal(byId.choice.type, 'object');
	assert.equal(byId.nothing.type, 'object');
	assert.deepEqual(byId.mode.options, [
		{ name: '1', value: 1 },
		{ name: '2', value: 2 },
	]);
});

test('resource mapping rejects missing or malformed input schemas', async () => {
	for (const inputSchema of [undefined, []]) {
		const detail = detailFixture({ inputSchema });
		const node = new AnyApi();
		const { ctx } = fakeContext({}, detail);
		ctx.getCurrentNodeParameter = () => detail.slug;
		await assert.rejects(
			() => node.methods.resourceMapping.getApiInputSchema.call(ctx),
			/detail\.inputSchema.*expected an object/i,
		);
	}
});

test('Fields mode preserves nested object, array, union, null, and native scalar values', async () => {
	const { fields } = await mappedFields();
	const { requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'fields',
			inputFields: {
				value: {
					query: '007',
					count: 7,
					enabled: false,
					mode: 2,
					filters: '{"author":{"active":true}}',
					items: '[{"id":1},null]',
					choice: 'false',
					nothing: 'null',
					optionalBlank: '',
				},
				schema: fields,
			},
			options: {},
		},
		{ output: {}, provider: 'AnyAPI', costUsd: 0, items: 0 },
	);

	assert.deepEqual(requests[0].body, {
		query: '007',
		count: 7,
		enabled: false,
		mode: 2,
		filters: { author: { active: true } },
		items: [{ id: 1 }, null],
		choice: false,
		nothing: null,
	});
});

test('Fields mode rejects malformed structured input before outbound transport', async () => {
	const { fields } = await mappedFields();
	const { output, requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'fields',
			inputFields: { value: { filters: '{not-json' }, schema: fields },
			options: {},
		},
		{},
		{ continueOnFail: true },
	);

	assert.equal(requests.length, 0);
	assert.match(output[0][0].json.error, /valid structured JSON/i);
	assert.match(output[0][0].json.error, /Input Mode "Raw JSON"/i);
});

test('Raw JSON mode is an exact fallback for nested and null values', async () => {
	const payload = {
		query: 'n8n',
		filters: { tags: ['automation', null] },
		choice: null,
	};
	const { requests } = await execute(
		{
			operation: 'run',
			sku: 'search.web',
			inputMode: 'json',
			input: JSON.stringify(payload),
			options: {},
		},
		{ output: {}, provider: 'AnyAPI', costUsd: 0, items: 0 },
	);
	assert.deepEqual(requests[0].body, payload);
});

test('Raw JSON mode rejects malformed or non-object payloads before transport', async () => {
	for (const input of ['{"query"', '[1,2]', 'null']) {
		const { output, requests } = await execute(
			{
				operation: 'run',
				sku: 'search.web',
				inputMode: 'json',
				input,
				options: {},
			},
			{},
			{ continueOnFail: true },
		);
		assert.equal(requests.length, 0);
		assert.match(output[0][0].json.error, /Input \(JSON\) must/i);
	}
});
