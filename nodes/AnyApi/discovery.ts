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
