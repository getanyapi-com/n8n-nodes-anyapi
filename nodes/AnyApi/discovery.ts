import type { IDataObject } from 'n8n-workflow';
import { UnexpectedError } from 'n8n-workflow';

type PricingOffer = {
	model: 'flat' | 'linear';
	unit: string;
	baseUsd?: number;
	perUnitUsd?: number;
	maxUsd: number;
};

type DiscoveryRequest = {
	method: 'GET';
	url: string;
	qs?: IDataObject;
	json: true;
};

type DiscoveryExchange<T> = {
	request: DiscoveryRequest;
	read: (value: unknown) => T;
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

function numberAt(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return contractError(path, 'expected a non-negative finite number');
	}
	return value;
}

function onlyKeys(value: IDataObject, allowed: readonly string[], path: string): void {
	for (const key of Object.keys(value)) {
		if (key.toLowerCase().includes('credit')) {
			contractError(`${path}.${key}`, 'internal accounting fields are forbidden');
		}
		if (!allowed.includes(key)) contractError(`${path}.${key}`, 'unexpected field');
	}
}

function assertCustomerSafeKeys(value: unknown, path: string): void {
	if (Array.isArray(value)) {
		value.forEach((entry, index) => assertCustomerSafeKeys(entry, `${path}[${index}]`));
		return;
	}
	if (value === null || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value)) {
		if (key.toLowerCase().includes('credit')) {
			contractError(`${path}.${key}`, 'internal accounting fields are forbidden');
		}
		if (key === 'provider' && typeof nested === 'string' && nested !== 'AnyAPI') {
			contractError(`${path}.${key}`, 'provider must be AnyAPI');
		}
		assertCustomerSafeKeys(nested, `${path}.${key}`);
	}
}

function offerAt(value: unknown, path: string): PricingOffer {
	const offer = recordAt(value, path);
	const model = stringAt(offer.model, `${path}.model`);
	if (model !== 'flat' && model !== 'linear') {
		return contractError(`${path}.model`, 'expected flat or linear');
	}
	const unit = stringAt(offer.unit, `${path}.unit`);
	if (unit.trim() === '') contractError(`${path}.unit`, 'must not be empty');
	const maxUsd = numberAt(offer.maxUsd, `${path}.maxUsd`);

	if (model === 'flat') {
		onlyKeys(offer, ['model', 'unit', 'maxUsd'], path);
		if (unit !== 'request') contractError(`${path}.unit`, 'flat offers use request');
		return { model, unit, maxUsd };
	}

	onlyKeys(offer, ['model', 'unit', 'baseUsd', 'perUnitUsd', 'maxUsd'], path);
	return {
		model,
		unit,
		baseUsd: numberAt(offer.baseUsd, `${path}.baseUsd`),
		perUnitUsd: numberAt(offer.perUnitUsd, `${path}.perUnitUsd`),
		maxUsd,
	};
}

function pricingAt(value: unknown, path: string): { from: PricingOffer; failoverMaxUsd: number } {
	const pricing = recordAt(value, path);
	onlyKeys(pricing, ['from', 'failoverMaxUsd'], path);
	const from = offerAt(pricing.from, `${path}.from`);
	const failoverMaxUsd = numberAt(pricing.failoverMaxUsd, `${path}.failoverMaxUsd`);
	if (failoverMaxUsd < from.maxUsd) {
		contractError(`${path}.failoverMaxUsd`, 'must be at least pricing.from.maxUsd');
	}
	return { from, failoverMaxUsd };
}

function sameOffer(left: PricingOffer, right: PricingOffer): boolean {
	return (
		left.model === right.model &&
		left.unit === right.unit &&
		left.baseUsd === right.baseUsd &&
		left.perUnitUsd === right.perUnitUsd &&
		left.maxUsd === right.maxUsd
	);
}

function healthAt(value: unknown, path: string): void {
	const health = recordAt(value, path);
	onlyKeys(health, ['window', 'uptimePct', 'latencyP50Ms', 'requests'], path);
	if (stringAt(health.window, `${path}.window`) !== '30d') {
		contractError(`${path}.window`, 'expected 30d');
	}
	numberAt(health.uptimePct, `${path}.uptimePct`);
	numberAt(health.latencyP50Ms, `${path}.latencyP50Ms`);
	numberAt(health.requests, `${path}.requests`);
}

function schemaAt(value: unknown, path: string, required: boolean): void {
	if (value === undefined && !required) return;
	recordAt(value, path);
}

function apiAt(value: unknown, path: string, requireSchemas: boolean): IDataObject {
	const api = recordAt(value, path);
	onlyKeys(
		api,
		[
			'id',
			'slug',
			'category',
			'name',
			'description',
			'provider',
			'pricing',
			'lanes',
			'inputSchema',
			'outputSchema',
			'heavy',
			'tryEligible',
		],
		path,
	);
	for (const field of ['id', 'slug', 'category', 'name', 'description']) {
		stringAt(api[field], `${path}.${field}`);
	}
	if (api.provider !== 'AnyAPI') contractError(`${path}.provider`, 'must be AnyAPI');
	const pricing = pricingAt(api.pricing, `${path}.pricing`);
	if (!Array.isArray(api.lanes)) contractError(`${path}.lanes`, 'expected an array');
	if (api.lanes.length === 0) contractError(`${path}.lanes`, 'expected at least one lane');
	let firstLaneOffer: PricingOffer | undefined;
	let greatestLaneMaxUsd = 0;
	api.lanes.forEach((rawLane, index) => {
		const lanePath = `${path}.lanes[${index}]`;
		const lane = recordAt(rawLane, lanePath);
		onlyKeys(lane, ['pricing', 'health'], lanePath);
		const offer = offerAt(lane.pricing, `${lanePath}.pricing`);
		if (index === 0) firstLaneOffer = offer;
		greatestLaneMaxUsd = Math.max(greatestLaneMaxUsd, offer.maxUsd);
		if (lane.health !== undefined) healthAt(lane.health, `${lanePath}.health`);
	});
	if (firstLaneOffer === undefined || !sameOffer(pricing.from, firstLaneOffer)) {
		contractError(`${path}.pricing.from`, 'must equal the first anonymous lane pricing');
	}
	if (pricing.failoverMaxUsd !== greatestLaneMaxUsd) {
		contractError(
			`${path}.pricing.failoverMaxUsd`,
			'must equal the greatest maxUsd across anonymous lane pricing',
		);
	}
	schemaAt(api.inputSchema, `${path}.inputSchema`, requireSchemas);
	schemaAt(api.outputSchema, `${path}.outputSchema`, requireSchemas);
	if (typeof api.tryEligible !== 'boolean') {
		contractError(`${path}.tryEligible`, 'expected a boolean');
	}
	if (api.heavy !== undefined && typeof api.heavy !== 'boolean') {
		contractError(`${path}.heavy`, 'expected a boolean');
	}
	assertCustomerSafeKeys(api, path);
	return api;
}

function browseResponse(value: unknown): IDataObject[] {
	const envelope = recordAt(value, 'browse');
	onlyKeys(envelope, ['apis'], 'browse');
	if (!Array.isArray(envelope.apis)) contractError('browse.apis', 'expected an array');
	return envelope.apis.map((api, index) => apiAt(api, `browse.apis[${index}]`, false));
}

function searchResultAt(value: unknown, path: string): void {
	const result = recordAt(value, path);
	onlyKeys(
		result,
		[
			'slug',
			'platformId',
			'name',
			'description',
			'category',
			'provider',
			'pricing',
			'relevance',
			'highlightFields',
		],
		path,
	);
	for (const field of ['slug', 'platformId', 'name', 'description', 'category']) {
		stringAt(result[field], `${path}.${field}`);
	}
	if (result.provider !== 'AnyAPI') contractError(`${path}.provider`, 'must be AnyAPI');
	pricingAt(result.pricing, `${path}.pricing`);
	const relevance = numberAt(result.relevance, `${path}.relevance`);
	if (relevance > 1) contractError(`${path}.relevance`, 'must not exceed 1');
	assertCustomerSafeKeys(result, path);
}

function searchResponse(value: unknown): IDataObject {
	const envelope = recordAt(value, 'search');
	onlyKeys(envelope, ['results', 'total', 'ranking'], 'search');
	if (!Array.isArray(envelope.results)) contractError('search.results', 'expected an array');
	envelope.results.forEach((result, index) => searchResultAt(result, `search.results[${index}]`));
	const total = numberAt(envelope.total, 'search.total');
	if (!Number.isInteger(total)) contractError('search.total', 'expected an integer');
	if (envelope.ranking !== 'semantic' && envelope.ranking !== 'keyword') {
		contractError('search.ranking', 'expected semantic or keyword');
	}
	assertCustomerSafeKeys(envelope, 'search');
	return envelope;
}

function fmtUsd(value: number): string {
	if (value >= 1) return `$${value.toFixed(2)}`;
	return `$${value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function priceLabel(value: unknown): string {
	const offer = pricingAt(value, 'catalog.pricing').from;
	if (offer.model === 'flat') return ` (${fmtUsd(offer.maxUsd)}/${offer.unit})`;
	const parts: string[] = [];
	if ((offer.baseUsd ?? 0) > 0) parts.push(`${fmtUsd(offer.baseUsd ?? 0)}/request`);
	if ((offer.perUnitUsd ?? 0) > 0) parts.push(`${fmtUsd(offer.perUnitUsd ?? 0)}/${offer.unit}`);
	parts.push(`max ${fmtUsd(offer.maxUsd)}`);
	return ` (${parts.join(' + ').replace(' + max ', ', max ')})`;
}

function catalogRequest(baseUrl: string): DiscoveryRequest {
	return { method: 'GET', url: `${baseUrl}/catalog`, json: true };
}

function browseRequest(baseUrl: string, category: unknown): DiscoveryRequest {
	const qs: IDataObject = {};
	if (typeof category === 'string' && category !== '') qs.category = category;
	return { method: 'GET', url: `${baseUrl}/v1/apis`, qs, json: true };
}

function detailRequest(baseUrl: string, slug: string): DiscoveryRequest {
	return { method: 'GET', url: `${baseUrl}/v1/apis/${encodeURIComponent(slug)}`, json: true };
}

function searchRequest(baseUrl: string, query: string, filters: IDataObject): DiscoveryRequest {
	const qs: IDataObject = { q: query };
	if (filters.category) qs.category = filters.category;
	if (filters.platform) qs.platform = filters.platform;
	if (filters.limit) qs.limit = filters.limit;
	return { method: 'GET', url: `${baseUrl}/catalog/search`, qs, json: true };
}

// The node crosses one focused Interface for customer-safe discovery. Transport
// execution and n8n UI orchestration remain in AnyApi.node.ts.
export const customerSafeDiscovery = {
	browse(baseUrl: string, category: unknown): DiscoveryExchange<IDataObject[]> {
		return { request: browseRequest(baseUrl, category), read: browseResponse };
	},
	catalog(baseUrl: string): DiscoveryExchange<IDataObject[]> {
		return { request: catalogRequest(baseUrl), read: browseResponse };
	},
	detail(baseUrl: string, slug: string): DiscoveryExchange<IDataObject> {
		return {
			request: detailRequest(baseUrl, slug),
			read: (value) => apiAt(value, 'detail', true),
		};
	},
	priceLabel,
	search(baseUrl: string, query: string, filters: IDataObject): DiscoveryExchange<IDataObject> {
		return { request: searchRequest(baseUrl, query, filters), read: searchResponse };
	},
};
