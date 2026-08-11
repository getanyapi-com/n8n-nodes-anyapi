import type { IDataObject } from 'n8n-workflow';
import { UnexpectedError } from 'n8n-workflow';

export type PricingOffer = {
	model: 'flat' | 'linear';
	unit: string;
	baseUsd?: number;
	perUnitUsd?: number;
	maxUsd: number;
};

function contractError(path: string, message: string): never {
	throw new UnexpectedError(`Customer-safe discovery contract violation at ${path}: ${message}`);
}

function recordAt(value: unknown, path: string): IDataObject {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return contractError(path, 'expected an object');
	}
	return value as IDataObject;
}

function stringAt(value: unknown, path: string): string {
	if (typeof value !== 'string') return contractError(path, 'expected a string');
	return value;
}

function finiteNumberAt(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return contractError(path, 'expected a finite number');
	}
	return value;
}

function integerAt(value: unknown, path: string): number {
	const number = finiteNumberAt(value, path);
	if (!Number.isInteger(number) || number < 0) {
		return contractError(path, 'expected a non-negative integer');
	}
	return number;
}

function booleanAt(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') return contractError(path, 'expected a boolean');
	return value;
}

export function assertCustomerSafe(value: unknown, path: string): void {
	if (Array.isArray(value)) {
		value.forEach((entry, index) => assertCustomerSafe(entry, `${path}[${index}]`));
		return;
	}
	if (value === null || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value)) {
		const nestedPath = `${path}.${key}`;
		if (key.toLowerCase().includes('credit')) {
			contractError(nestedPath, 'internal accounting fields are forbidden');
		}
		if (key === 'provider' && nested !== 'AnyAPI') {
			contractError(nestedPath, 'provider must be AnyAPI');
		}
		assertCustomerSafe(nested, nestedPath);
	}
}

export function offerAt(value: unknown, path: string): PricingOffer {
	const offer = recordAt(value, path);
	const model = stringAt(offer.model, `${path}.model`);
	if (model !== 'flat' && model !== 'linear') {
		return contractError(`${path}.model`, 'expected flat or linear');
	}
	const maxUsd = finiteNumberAt(offer.maxUsd, `${path}.maxUsd`);
	if (maxUsd < 0) contractError(`${path}.maxUsd`, 'expected a non-negative number');
	const projected: PricingOffer = {
		model,
		unit: stringAt(offer.unit, `${path}.unit`),
		maxUsd,
	};
	if (projected.unit.trim() === '') contractError(`${path}.unit`, 'must not be empty');
	if (model === 'linear') {
		projected.baseUsd = nonNegativeAt(offer.baseUsd, `${path}.baseUsd`);
		projected.perUnitUsd = nonNegativeAt(offer.perUnitUsd, `${path}.perUnitUsd`);
	}
	return projected;
}

function nonNegativeAt(value: unknown, path: string): number {
	const number = finiteNumberAt(value, path);
	if (number < 0) return contractError(path, 'expected a non-negative number');
	return number;
}

export function pricingAt(value: unknown, path: string): IDataObject {
	const pricing = recordAt(value, path);
	return {
		from: offerAt(pricing.from, `${path}.from`) as unknown as IDataObject,
		failoverMaxUsd: nonNegativeAt(pricing.failoverMaxUsd, `${path}.failoverMaxUsd`),
	};
}

function operationAt(source: IDataObject, path: string): IDataObject {
	return {
		method: stringAt(source.method, `${path}.method`),
		path: stringAt(source.path, `${path}.path`),
		execution: executionAt(source.execution, `${path}.execution`),
	};
}

function executionAt(value: unknown, path: string): IDataObject {
	const execution = recordAt(value, path);
	const mode = stringAt(execution.mode, `${path}.mode`);
	if (mode !== 'sync' && mode !== 'durable') {
		return contractError(`${path}.mode`, 'expected sync or durable');
	}
	return { mode };
}

function sourceAt(value: unknown, path: string): IDataObject {
	const source = recordAt(value, path);
	const kind = stringAt(source.kind, `${path}.kind`);
	if (kind !== 'anonymous' && kind !== 'brand') {
		contractError(`${path}.kind`, 'expected anonymous or brand');
	}
	return {
		id: stringAt(source.id, `${path}.id`),
		name: stringAt(source.name, `${path}.name`),
		kind,
		artworkKey: stringAt(source.artworkKey, `${path}.artworkKey`),
	};
}

function healthAt(value: unknown, path: string): IDataObject {
	const health = recordAt(value, path);
	return {
		window: stringAt(health.window, `${path}.window`),
		uptimePct: finiteNumberAt(health.uptimePct, `${path}.uptimePct`),
		latencyP50Ms: finiteNumberAt(health.latencyP50Ms, `${path}.latencyP50Ms`),
		uptimeSample: integerAt(health.uptimeSample, `${path}.uptimeSample`),
		latencySample: integerAt(health.latencySample, `${path}.latencySample`),
		requests: integerAt(health.requests, `${path}.requests`),
		servedRequests: integerAt(health.servedRequests, `${path}.servedRequests`),
	};
}

function laneAt(value: unknown, path: string): IDataObject {
	const lane = recordAt(value, path);
	const projected: IDataObject = {
		pricing: offerAt(lane.pricing, `${path}.pricing`) as unknown as IDataObject,
		source: sourceAt(lane.source, `${path}.source`),
	};
	if (lane.health !== undefined) projected.health = healthAt(lane.health, `${path}.health`);
	return projected;
}

function latencyAt(value: unknown, path: string): IDataObject | null {
	if (value === null) return null;
	const latency = recordAt(value, path);
	const window = stringAt(latency.window, `${path}.window`);
	const p50Ms = integerAt(latency.p50Ms, `${path}.p50Ms`);
	const p95Ms = integerAt(latency.p95Ms, `${path}.p95Ms`);
	const p99Ms = integerAt(latency.p99Ms, `${path}.p99Ms`);
	const sample = integerAt(latency.sample, `${path}.sample`);
	if (sample === 0) contractError(`${path}.sample`, 'expected a positive integer');
	const basis = stringAt(latency.basis, `${path}.basis`);
	if (basis !== 'service_time_excludes_caller_requested_delay') {
		contractError(`${path}.basis`, 'expected service_time_excludes_caller_requested_delay');
	}
	return {
		window,
		p50Ms,
		p95Ms,
		p99Ms,
		sample,
		basis,
	};
}

function optionalScalar(source: IDataObject, target: IDataObject, field: string, path: string): void {
	if (source[field] === undefined) return;
	if (field === 'tryMaxItems') target[field] = integerAt(source[field], `${path}.${field}`);
	else {
		const value = booleanAt(source[field], `${path}.${field}`);
		if (field === 'excludesCallerDelay' && !value) {
			contractError(`${path}.${field}`, 'expected true or an absent field');
		}
		target[field] = value;
	}
}

export function apiAt(value: unknown, path: string, detail: boolean): IDataObject {
	const api = recordAt(value, path);
	if (!Array.isArray(api.lanes)) contractError(`${path}.lanes`, 'expected an array');
	const projected: IDataObject = {
		id: stringAt(api.id, `${path}.id`),
		slug: stringAt(api.slug, `${path}.slug`),
		category: stringAt(api.category, `${path}.category`),
		name: stringAt(api.name, `${path}.name`),
		description: stringAt(api.description, `${path}.description`),
		...operationAt(api, path),
		provider: stringAt(api.provider, `${path}.provider`),
		pricing: pricingAt(api.pricing, `${path}.pricing`),
		lanes: api.lanes.map((lane, index) => laneAt(lane, `${path}.lanes[${index}]`)),
		tryEligible: booleanAt(api.tryEligible, `${path}.tryEligible`),
	};
	for (const field of ['heavy', 'tryMaxItems', 'failover', 'excludesCallerDelay']) {
		optionalScalar(api, projected, field, path);
	}
	if (!detail) return projected;
	projected.inputSchema = recordAt(api.inputSchema, `${path}.inputSchema`);
	projected.outputSchema = recordAt(api.outputSchema, `${path}.outputSchema`);
	if (api.latency !== undefined) projected.latency = latencyAt(api.latency, `${path}.latency`);
	return projected;
}

function highlightAt(value: unknown, path: string): IDataObject {
	const highlight = recordAt(value, path);
	const projected: IDataObject = {
		path: stringAt(highlight.path, `${path}.path`),
		type: stringAt(highlight.type, `${path}.type`),
	};
	if (highlight.why !== undefined) projected.why = stringAt(highlight.why, `${path}.why`);
	return projected;
}

function searchResultAt(value: unknown, path: string): IDataObject {
	const result = recordAt(value, path);
	const projected: IDataObject = {
		slug: stringAt(result.slug, `${path}.slug`),
		platformId: stringAt(result.platformId, `${path}.platformId`),
		name: stringAt(result.name, `${path}.name`),
		description: stringAt(result.description, `${path}.description`),
		category: stringAt(result.category, `${path}.category`),
		...operationAt(result, path),
		provider: stringAt(result.provider, `${path}.provider`),
		pricing: pricingAt(result.pricing, `${path}.pricing`),
		relevance: finiteNumberAt(result.relevance, `${path}.relevance`),
	};
	for (const field of ['tryMaxItems', 'failover', 'excludesCallerDelay']) {
		optionalScalar(result, projected, field, path);
	}
	if (result.highlightFields !== undefined) {
		if (!Array.isArray(result.highlightFields)) {
			contractError(`${path}.highlightFields`, 'expected an array');
		}
		projected.highlightFields = result.highlightFields.map((highlight, index) =>
			highlightAt(highlight, `${path}.highlightFields[${index}]`),
		);
	}
	return projected;
}

export function browseResponse(value: unknown): IDataObject[] {
	assertCustomerSafe(value, 'browse');
	const envelope = recordAt(value, 'browse');
	if (!Array.isArray(envelope.apis)) contractError('browse.apis', 'expected an array');
	return envelope.apis.map((api, index) => apiAt(api, `browse.apis[${index}]`, false));
}

export function detailResponse(value: unknown): IDataObject {
	assertCustomerSafe(value, 'detail');
	return apiAt(value, 'detail', true);
}

export function searchResponse(value: unknown): IDataObject {
	assertCustomerSafe(value, 'search');
	const envelope = recordAt(value, 'search');
	if (!Array.isArray(envelope.results)) contractError('search.results', 'expected an array');
	const total = integerAt(envelope.total, 'search.total');
	const ranking = stringAt(envelope.ranking, 'search.ranking');
	if (ranking !== 'semantic' && ranking !== 'keyword') {
		contractError('search.ranking', 'expected semantic or keyword');
	}
	return {
		results: envelope.results.map((result, index) =>
			searchResultAt(result, `search.results[${index}]`),
		),
		total,
		ranking,
	};
}
