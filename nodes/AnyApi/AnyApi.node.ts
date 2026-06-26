import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const DEFAULT_BASE_URL = 'https://api.getanyapi.com';

// Credits are AnyAPI's internal accounting unit (1 credit = $0.00001 USD). The
// public catalog returns a "from" price in credits; the dropdown shows USD.
const CREDIT_USD = 0.00001;

// Resolves the gateway base URL from the credential, trimming any trailing slash.
async function baseUrlFor(ctx: IExecuteFunctions | ILoadOptionsFunctions): Promise<string> {
	const creds = await ctx.getCredentials('anyApiApi');
	const raw = ((creds.baseUrl as string) || DEFAULT_BASE_URL).trim();
	return raw.replace(/\/+$/, '');
}

export class AnyApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AnyAPI',
		name: 'anyApi',
		icon: 'file:anyapi.svg',
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ $parameter["operation"] + ($parameter["sku"] ? ": " + $parameter["sku"] : "") }}',
		description: 'Run any scraping or data API through AnyAPI, billed per request in USD',
		defaults: { name: 'AnyAPI' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'anyApiApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Run API',
						value: 'run',
						action: 'Run an API',
						description: 'Execute an API by SKU with a normalized input payload',
					},
					{
						name: 'Get API Schema',
						value: 'getSchema',
						action: 'Get an API schema',
						description: 'Fetch the input and output schema for one API',
					},
					{
						name: 'List APIs',
						value: 'list',
						action: 'List available APIs',
						description: 'Browse the AnyAPI catalog',
					},
					{
						name: 'Get Balance',
						value: 'getBalance',
						action: 'Get wallet balance',
						description: 'Return the remaining wallet balance in USD',
					},
				],
				default: 'run',
			},
			{
				displayName: 'API Name or ID',
				name: 'sku',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSkus' },
				required: true,
				default: '',
				description:
					'The API to call. Choose from the list, or specify a SKU slug using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { operation: ['run', 'getSchema'] } },
			},
			{
				displayName: 'Input',
				name: 'input',
				type: 'json',
				default: '{}',
				description: 'Normalized input payload matching the API input schema',
				displayOptions: { show: { operation: ['run'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['run'] } },
				options: [
					{
						displayName: 'Fields',
						name: 'fields',
						type: 'string',
						default: '',
						description:
							'Comma-separated keys to keep on each result item (dotted paths allowed). Trims the response; does not change cost.',
					},
					{
						displayName: 'Max Items',
						name: 'maxItems',
						type: 'number',
						default: 0,
						description:
							'Cap the number of result items returned (0 means no cap). Does not change cost.',
					},
					{
						displayName: 'Summary Only',
						name: 'summary',
						type: 'boolean',
						default: false,
						description:
							'Whether to return only a structural outline instead of the full data. Does not change cost.',
					},
				],
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['list'] } },
				options: [
					{
						displayName: 'Query',
						name: 'query',
						type: 'string',
						default: '',
						description: 'Free-text filter over API name and description',
					},
					{
						displayName: 'Category',
						name: 'category',
						type: 'string',
						default: '',
						description: 'Category slug to filter by',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			// Populates the API dropdown live from the public catalog, so new SKUs
			// appear without republishing the node. No auth needed: /catalog is public.
			async getSkus(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const baseUrl = await baseUrlFor(this);
				const res = (await this.helpers.httpRequest({
					method: 'GET',
					url: `${baseUrl}/catalog`,
					json: true,
				})) as { apis?: IDataObject[] };

				const options = (res.apis ?? []).map((a) => {
					const slug = String(a.slug ?? '');
					const name = String(a.name ?? slug);
					const usd =
						typeof a.fromCredits === 'number' ? (a.fromCredits as number) * CREDIT_USD : undefined;
					const price = usd !== undefined ? ` ($${usd.toFixed(4)}/req)` : '';
					return {
						name: `${name}${price}`,
						value: slug,
						description: String(a.description ?? ''),
					} as INodePropertyOptions;
				});

				options.sort((a, b) => a.name.localeCompare(b.name));
				return options;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		const baseUrl = await baseUrlFor(this);

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[];

				if (operation === 'run') {
					const sku = this.getNodeParameter('sku', i) as string;
					const rawInput = this.getNodeParameter('input', i, {}) as IDataObject | string;
					let body: IDataObject;
					if (typeof rawInput === 'string') {
						body = rawInput.trim() === '' ? {} : (JSON.parse(rawInput) as IDataObject);
					} else {
						body = rawInput ?? {};
					}

					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (options.fields) qs.fields = options.fields;
					if (options.maxItems && Number(options.maxItems) > 0) qs.max_items = options.maxItems;
					if (options.summary) qs.summary = true;

					responseData = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'anyApiApi',
						{
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/v1/run/${encodeURIComponent(sku)}`,
							body,
							qs,
							json: true,
						},
					)) as IDataObject;
				} else if (operation === 'getSchema') {
					const sku = this.getNodeParameter('sku', i) as string;
					responseData = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'anyApiApi',
						{
							method: 'GET' as IHttpRequestMethods,
							url: `${baseUrl}/v1/apis/${encodeURIComponent(sku)}`,
							json: true,
						},
					)) as IDataObject;
				} else if (operation === 'list') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (filters.query) qs.query = filters.query;
					if (filters.category) qs.category = filters.category;

					const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'anyApiApi', {
						method: 'GET' as IHttpRequestMethods,
						url: `${baseUrl}/v1/apis`,
						qs,
						json: true,
					})) as { apis?: IDataObject[] };
					responseData = res.apis ?? [];
				} else {
					responseData = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'anyApiApi',
						{
							method: 'GET' as IHttpRequestMethods,
							url: `${baseUrl}/v1/balance`,
							json: true,
						},
					)) as IDataObject;
				}

				const entries = Array.isArray(responseData) ? responseData : [responseData];
				for (const entry of entries) {
					returnData.push({ json: entry, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}
		}

		return [returnData];
	}
}
