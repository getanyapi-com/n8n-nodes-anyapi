const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const { golden, goldenPath, provenancePath } = require('./helpers.cjs');

test('shared discovery V1 golden has offline-verifiable source provenance', () => {
	const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
	const checksum = createHash('sha256').update(readFileSync(goldenPath)).digest('hex');

	assert.equal(golden.version, 1);
	assert.equal(provenance.sourceRepository, 'getanyapi-com/anyapi');
	assert.equal(provenance.sourcePath, 'testdata/discovery-v1.json');
	assert.match(provenance.sourceCommit, /^[0-9a-f]{40}$/);
	assert.match(provenance.sha256, /^[0-9a-f]{64}$/);
	assert.equal(checksum, provenance.sha256);
});
