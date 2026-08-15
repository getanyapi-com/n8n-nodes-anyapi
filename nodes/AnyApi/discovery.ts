import type { IDataObject } from 'n8n-workflow';

import {
	browseResponse,
	detailResponse,
	pricingAt,
	searchResponse,
	type PricingOffer,
} from './discoveryReader';

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

/** The unit every catalog price the node shows a human is quoted in. */
const REQUEST_RATE_LABEL = '/1k req';

function fmtUsd(value: number): string {
	if (value >= 1) return `$${value.toFixed(2)}`;
	return `$${value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
}

/**
 * Catalog prices are quoted per 1,000 requests, the denomination AnyAPI shows
 * customers everywhere, because most of the catalog costs a fraction of a cent
 * per call and per-request figures cannot be compared by eye. The rate is the
 * offer's published `maxPer1kUsd`, never `maxUsd` scaled here. A per-unit rate
 * is charged per billable item rather than per request, so it keeps its own
 * denomination; a linear offer's per-request base has no published per-1k twin
 * and is left to the offer itself rather than quoted in a second denomination
 * beside the comparable rate.
 */
function priceLabel(value: unknown): string {
	const pricing = pricingAt(value, 'catalog.pricing');
	const offer = pricing.from as unknown as PricingOffer;
	const rate = `${fmtUsd(offer.maxPer1kUsd)}${REQUEST_RATE_LABEL}`;
	if (offer.model === 'flat') return ` (${rate})`;
	const perUnit = offer.perUnitUsd ?? 0;
	if (perUnit <= 0) return ` (${rate})`;
	return ` (${fmtUsd(perUnit)}/${offer.unit}, max ${rate})`;
}

function browseRequest(baseUrl: string, category: unknown): DiscoveryRequest {
	const qs: IDataObject = {};
	if (typeof category === 'string' && category !== '') qs.category = category;
	return { method: 'GET', url: `${baseUrl}/v1/apis`, qs, json: true };
}

function searchRequest(baseUrl: string, query: string, filters: IDataObject): DiscoveryRequest {
	const qs: IDataObject = { q: query };
	if (filters.category) qs.category = filters.category;
	if (filters.platform) qs.platform = filters.platform;
	if (filters.limit) qs.limit = filters.limit;
	return { method: 'GET', url: `${baseUrl}/catalog/search`, qs, json: true };
}

export const customerSafeDiscovery = {
	browse(baseUrl: string, category: unknown): DiscoveryExchange<IDataObject[]> {
		return { request: browseRequest(baseUrl, category), read: browseResponse };
	},
	catalog(baseUrl: string): DiscoveryExchange<IDataObject[]> {
		return { request: { method: 'GET', url: `${baseUrl}/catalog`, json: true }, read: browseResponse };
	},
	detail(baseUrl: string, slug: string): DiscoveryExchange<IDataObject> {
		return {
			request: {
				method: 'GET',
				url: `${baseUrl}/v1/apis/${encodeURIComponent(slug)}`,
				json: true,
			},
			read: detailResponse,
		};
	},
	priceLabel,
	search(baseUrl: string, query: string, filters: IDataObject): DiscoveryExchange<IDataObject> {
		return { request: searchRequest(baseUrl, query, filters), read: searchResponse };
	},
};
