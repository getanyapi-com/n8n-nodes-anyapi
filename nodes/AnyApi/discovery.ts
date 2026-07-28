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

function finiteNumberAt(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return contractError(path, 'expected a finite number');
	}
	return value;
}

function usdAt(value: unknown, path: string): number {
	const amount = finiteNumberAt(value, path);
	if (amount < 0) return contractError(path, 'expected a non-negative finite number');
	return amount;
}

function booleanAt(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') return contractError(path, 'expected a boolean');
	return value;
}

// Scan the complete raw payload before projection. Unknown fields are forward-compatible,
// but internal accounting names and upstream provider identities are never customer-safe.
function assertCustomerSafe(value: unknown, path: string): void {
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

function offerAt(value: unknown, path: string): PricingOffer {
	const offer = recordAt(value, path);
	const model = stringAt(offer.model, `${path}.model`);
	if (model !== 'flat' && model !== 'linear') {
		return contractError(`${path}.model`, 'expected flat or linear');
	}

	const projected: PricingOffer = {
		model,
		unit: stringAt(offer.unit, `${path}.unit`),
		maxUsd: usdAt(offer.maxUsd, `${path}.maxUsd`),
	};
	if (projected.unit.trim() === '') contractError(`${path}.unit`, 'must not be empty');

	if (model === 'linear') {
		projected.baseUsd = usdAt(offer.baseUsd, `${path}.baseUsd`);
		projected.perUnitUsd = usdAt(offer.perUnitUsd, `${path}.perUnitUsd`);
	}
	return projected;
}

function pricingAt(value: unknown, path: string): IDataObject {
	const pricing = recordAt(value, path);
	return {
		from: offerAt(pricing.from, `${path}.from`) as unknown as IDataObject,
		failoverMaxUsd: usdAt(pricing.failoverMaxUsd, `${path}.failoverMaxUsd`),
	};
}

function healthAt(value: unknown, path: string): IDataObject {
	const health = recordAt(value, path);
	return {
		window: stringAt(health.window, `${path}.window`),
		uptimePct: finiteNumberAt(health.uptimePct, `${path}.uptimePct`),
		latencyP50Ms: finiteNumberAt(health.latencyP50Ms, `${path}.latencyP50Ms`),
		requests: finiteNumberAt(health.requests, `${path}.requests`),
	};
}

function schemaAt(value: unknown, path: string, required: boolean): IDataObject | undefined {
	if (value === undefined && !required) return undefined;
	return recordAt(value, path);
}

function laneAt(value: unknown, path: string): IDataObject {
	const lane = recordAt(value, path);
	const projected: IDataObject = {
		pricing: pricingOfferObjectAt(lane.pricing, `${path}.pricing`),
	};
	if (lane.health !== undefined) projected.health = healthAt(lane.health, `${path}.health`);
	return projected;
}

function pricingOfferObjectAt(value: unknown, path: string): IDataObject {
	return offerAt(value, path) as unknown as IDataObject;
}

function optionalBoolean(
	source: IDataObject,
	target: IDataObject,
	field: string,
	path: string,
): void {
	if (source[field] !== undefined) target[field] = booleanAt(source[field], `${path}.${field}`);
}

function apiAt(value: unknown, path: string, requireSchemas: boolean): IDataObject {
	const api = recordAt(value, path);
	const lanes = api.lanes;
	if (!Array.isArray(lanes)) contractError(`${path}.lanes`, 'expected an array');

	const projected: IDataObject = {
		id: stringAt(api.id, `${path}.id`),
		slug: stringAt(api.slug, `${path}.slug`),
		category: stringAt(api.category, `${path}.category`),
		name: stringAt(api.name, `${path}.name`),
		description: stringAt(api.description, `${path}.description`),
		provider: stringAt(api.provider, `${path}.provider`),
		pricing: pricingAt(api.pricing, `${path}.pricing`),
		lanes: lanes.map((lane, index) => laneAt(lane, `${path}.lanes[${index}]`)),
		tryEligible: booleanAt(api.tryEligible, `${path}.tryEligible`),
	};

	const inputSchema = schemaAt(api.inputSchema, `${path}.inputSchema`, requireSchemas);
	if (inputSchema !== undefined) projected.inputSchema = inputSchema;
	const outputSchema = schemaAt(api.outputSchema, `${path}.outputSchema`, requireSchemas);
	if (outputSchema !== undefined) projected.outputSchema = outputSchema;
	optionalBoolean(api, projected, 'heavy', path);
	optionalBoolean(api, projected, 'failover', path);
	optionalBoolean(api, projected, 'excludesCallerDelay', path);
	return projected;
}

function browseResponse(value: unknown): IDataObject[] {
	assertCustomerSafe(value, 'browse');
	const envelope = recordAt(value, 'browse');
	if (!Array.isArray(envelope.apis)) contractError('browse.apis', 'expected an array');
	return envelope.apis.map((api, index) => apiAt(api, `browse.apis[${index}]`, false));
}

function highlightAt(value: unknown, path: string): IDataObject {
	const highlight = recordAt(value, path);
	const projected: IDataObject = {
		path: stringAt(highlight.path, `${path}.path`),
		type: stringAt(highlight.type, `${path}.type`),
	};
	if (highlight.why !== undefined) {
		projected.why = stringAt(highlight.why, `${path}.why`);
	}
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
		provider: stringAt(result.provider, `${path}.provider`),
		pricing: pricingAt(result.pricing, `${path}.pricing`),
		relevance: finiteNumberAt(result.relevance, `${path}.relevance`),
	};
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

function searchResponse(value: unknown): IDataObject {
	assertCustomerSafe(value, 'search');
	const envelope = recordAt(value, 'search');
	if (!Array.isArray(envelope.results)) contractError('search.results', 'expected an array');
	const total = finiteNumberAt(envelope.total, 'search.total');
	if (!Number.isInteger(total) || total < 0) contractError('search.total', 'expected a non-negative integer');
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

function fmtUsd(value: number): string {
	if (value >= 1) return `$${value.toFixed(2)}`;
	return `$${value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function priceLabel(value: unknown): string {
	const pricing = pricingAt(value, 'catalog.pricing');
	const offer = pricing.from as unknown as PricingOffer;
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
			read: (value) => {
				assertCustomerSafe(value, 'detail');
				return apiAt(value, 'detail', true);
			},
		};
	},
	priceLabel,
	search(baseUrl: string, query: string, filters: IDataObject): DiscoveryExchange<IDataObject> {
		return { request: searchRequest(baseUrl, query, filters), read: searchResponse };
	},
};
