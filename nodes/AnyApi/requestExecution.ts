import { randomUUID } from 'node:crypto';

import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { customerSafeDiscovery } from './discovery';
import { decodeFieldsInput, decodeRawInput } from './schemaCodec';

const DEFAULT_BASE_URL = 'https://api.getanyapi.com';

export async function baseUrlFor(
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<string> {
	const credentials = await context.getCredentials('anyApiApi');
	const raw = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).trim();
	return raw.replace(/\/+$/, '');
}

function isPendingRequest(value: IDataObject): boolean {
	return value.status === 'queued' || value.status === 'running';
}

function completedRequestResult(value: IDataObject, node: INode): IDataObject {
	if (value.status === 'succeeded' && value.result && typeof value.result === 'object') {
		return value.result as IDataObject;
	}
	if (value.resultExpired === true) {
		throw new NodeOperationError(node, 'The Request succeeded, but its retained result has expired.');
	}
	const error = value.error as IDataObject | undefined;
	throw new NodeOperationError(
		node,
		`The Request ended with ${String(error?.code ?? value.status ?? 'failed')}.`,
	);
}

function maxItemsError(node: INode): never {
	throw new NodeOperationError(
		node,
		'Max Items must be a non-negative integer. Use 0 to return all items.',
	);
}

function maxItemsAt(value: unknown, node: INode): number | string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === 'string') {
		const maxItems = value.trim();
		if (!/^[+-]?\d+$/.test(maxItems)) maxItemsError(node);
		const numeric = Number(maxItems);
		if (!Number.isFinite(numeric) || numeric < 0) maxItemsError(node);
		if (numeric === 0) return undefined;
		return Number.isSafeInteger(numeric) ? numeric : maxItems;
	}
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 0
	) {
		maxItemsError(node);
	}
	return value === 0 ? undefined : value;
}

async function requestSnapshot(
	context: IExecuteFunctions,
	baseUrl: string,
	requestId: string,
): Promise<IDataObject> {
	return (await context.helpers.httpRequestWithAuthentication.call(context, 'anyApiApi', {
		method: 'GET' as IHttpRequestMethods,
		url: `${baseUrl}/v1/requests/${encodeURIComponent(requestId)}`,
		json: true,
	})) as IDataObject;
}

async function waitForRequest(
	context: IExecuteFunctions,
	baseUrl: string,
	initial: IDataObject,
): Promise<IDataObject> {
	let snapshot = initial;
	const deadline = Date.now() + 300_000;
	while (isPendingRequest(snapshot)) {
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				context.getNode(),
				`Request ${String(snapshot.requestId)} is still running. Resume it with the Wait Request operation.`,
			);
		}
		const delaySeconds = Math.max(1, Number(snapshot.retryAfterSeconds ?? 2));
		await sleep(delaySeconds * 1000);
		snapshot = await requestSnapshot(context, baseUrl, String(snapshot.requestId));
	}
	return completedRequestResult(snapshot, context.getNode());
}

async function runOperation(
	context: IExecuteFunctions,
	baseUrl: string,
	item: number,
): Promise<IDataObject> {
	const sku = context.getNodeParameter('sku', item) as string;
	const inputMode = context.getNodeParameter('inputMode', item, 'fields') as string;
	const body =
		inputMode === 'json'
			? decodeRawInput(context.getNodeParameter('input', item, {}), context.getNode())
			: decodeFieldsInput(
					context.getNodeParameter('inputFields', item, { value: {}, schema: [] }),
					context.getNode(),
				);
	const options = context.getNodeParameter('options', item, {}) as IDataObject;
	const returnImmediately = options.returnImmediately === true;
	const query: IDataObject = {};
	if (options.fields) query.fields = options.fields;
	const maxItems = maxItemsAt(options.maxItems, context.getNode());
	if (maxItems !== undefined) query.max_items = maxItems;
	if (options.summary === true) query.summary = true;

	const response = (await context.helpers.httpRequestWithAuthentication.call(
		context,
		'anyApiApi',
		{
			method: 'POST' as IHttpRequestMethods,
			url: `${baseUrl}/v1/run/${encodeURIComponent(sku)}`,
			body,
			qs: query,
			headers: {
				'Idempotency-Key': `n8n-${randomUUID()}`,
				...(returnImmediately ? { Prefer: 'respond-async' } : {}),
			},
			json: true,
		},
	)) as IDataObject;
	return isPendingRequest(response) && !returnImmediately
		? await waitForRequest(context, baseUrl, response)
		: response;
}

async function discoveryOperation(
	context: IExecuteFunctions,
	baseUrl: string,
	item: number,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getSchema') {
		const sku = context.getNodeParameter('sku', item) as string;
		const discovery = customerSafeDiscovery.detail(baseUrl, sku);
		return discovery.read(
			await context.helpers.httpRequestWithAuthentication.call(context, 'anyApiApi', discovery.request),
		);
	}
	if (operation === 'list') {
		const filters = context.getNodeParameter('filters', item, {}) as IDataObject;
		const discovery = customerSafeDiscovery.browse(baseUrl, filters.category);
		return discovery.read(
			await context.helpers.httpRequestWithAuthentication.call(context, 'anyApiApi', discovery.request),
		);
	}
	const query = context.getNodeParameter('query', item) as string;
	const filters = context.getNodeParameter('searchFilters', item, {}) as IDataObject;
	const discovery = customerSafeDiscovery.search(baseUrl, query, filters);
	return discovery.read(
		await context.helpers.httpRequestWithAuthentication.call(context, 'anyApiApi', discovery.request),
	);
}

async function executeOperation(
	context: IExecuteFunctions,
	baseUrl: string,
	item: number,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'run') return runOperation(context, baseUrl, item);
	if (operation === 'getRequest') {
		return requestSnapshot(context, baseUrl, context.getNodeParameter('requestId', item) as string);
	}
	if (operation === 'waitRequest') {
		const snapshot = await requestSnapshot(
			context,
			baseUrl,
			context.getNodeParameter('requestId', item) as string,
		);
		return waitForRequest(context, baseUrl, snapshot);
	}
	if (operation === 'getSchema' || operation === 'list' || operation === 'search') {
		return discoveryOperation(context, baseUrl, item, operation);
	}
	if (operation === 'getBalance') {
		return (await context.helpers.httpRequestWithAuthentication.call(context, 'anyApiApi', {
			method: 'GET' as IHttpRequestMethods,
			url: `${baseUrl}/v1/balance`,
			json: true,
		})) as IDataObject;
	}
	throw new NodeOperationError(context.getNode(), `Unsupported AnyAPI operation: ${operation}`);
}

export async function executeAnyApi(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const inputItems = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;
	const baseUrl = await baseUrlFor(this);

	for (let item = 0; item < inputItems.length; item++) {
		try {
			const response = await executeOperation(this, baseUrl, item, operation);
			for (const entry of Array.isArray(response) ? response : [response]) {
				returnData.push({ json: entry, pairedItem: { item } });
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item } });
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: item });
		}
	}
	return [returnData];
}
