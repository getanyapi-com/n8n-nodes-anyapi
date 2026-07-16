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
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { customerSafeDiscovery } from './discovery';

const DEFAULT_BASE_URL = 'https://api.getanyapi.com';

// Converts an API input JSON Schema into n8n Resource Mapper fields, so the Run
// API form renders typed inputs (with required flags and enum dropdowns) instead
// of a raw JSON blob. Driven entirely by the live schema, so it tracks any SKU.
function schemaToResourceFields(schema: IDataObject): ResourceMapperField[] {
	const props = (schema.properties as IDataObject) ?? {};
	const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
	const fields: ResourceMapperField[] = [];

	for (const [name, raw] of Object.entries(props)) {
		const p = (raw ?? {}) as IDataObject;
		const jsonType = String(p.type ?? 'string');
		let type: ResourceMapperField['type'] = 'string';
		let options: INodePropertyOptions[] | undefined;

		if (Array.isArray(p.enum)) {
			type = 'options';
			options = (p.enum as unknown[]).map((v) => ({ name: String(v), value: String(v) }));
		} else if (jsonType === 'integer' || jsonType === 'number') {
			type = 'number';
		} else if (jsonType === 'boolean') {
			type = 'boolean';
		}
		// Arrays and objects fall through to a string field; enter them as JSON.

		fields.push({
			id: name,
			displayName: name,
			required: required.includes(name),
			defaultMatch: false,
			display: true,
			type,
			...(options ? { options } : {}),
		});
	}

	return fields;
}

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
		// Lets the node be attached to an AI Agent as a tool, so the model can call
		// any AnyAPI endpoint itself. Required since n8n 2.x exposes a node as a tool
		// only when it opts in here (the old community tool-usage env var is gone).
		usableAsTool: true,
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
						name: 'Get API Schema',
						value: 'getSchema',
						action: 'Get an API schema',
						description: 'Fetch the input and output schema for one API',
					},
					{
						name: 'Get Balance',
						value: 'getBalance',
						action: 'Get wallet balance',
						description: 'Return the remaining wallet balance in USD',
					},
					{
						name: 'List APIs',
						value: 'list',
						action: 'List available data sources',
						description: 'Browse the AnyAPI catalog',
					},
					{
						name: 'Run API',
						value: 'run',
						action: 'Run an API',
						description: 'Execute an API by SKU with a normalized input payload',
					},
					{
						name: 'Search APIs',
						value: 'search',
						action: 'Search available data sources',
						description: 'Run a ranked search over the AnyAPI catalog',
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
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { operation: ['run', 'getSchema'] } },
			},
			{
				displayName: 'Input Mode',
				name: 'inputMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fields (From Schema)',
						value: 'fields',
						description: 'Fill typed fields loaded from the selected API schema',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Provide the raw JSON payload (supports expressions)',
					},
				],
				default: 'fields',
				displayOptions: { show: { operation: ['run'] } },
			},
			{
				displayName: 'Input',
				name: 'inputFields',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['sku'],
					resourceMapper: {
						resourceMapperMethod: 'getApiInputSchema',
						mode: 'add',
						fieldWords: { singular: 'input field', plural: 'input fields' },
						addAllFields: true,
						multiKeyMatch: false,
						supportAutoMap: true,
					},
				},
				displayOptions: { show: { operation: ['run'], inputMode: ['fields'] } },
			},
			{
				displayName: 'Input (JSON)',
				name: 'input',
				type: 'json',
				default: '{}',
				description: 'Normalized input payload matching the API input schema',
				displayOptions: { show: { operation: ['run'], inputMode: ['json'] } },
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
						displayName: 'Category',
						name: 'category',
						type: 'string',
						default: '',
						description: 'Category slug to filter by',
					},
				],
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				description: 'Words or intent to rank against API names and descriptions',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Search Filters',
				name: 'searchFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['search'] } },
				options: [
					{
						displayName: 'Category',
						name: 'category',
						type: 'string',
						default: '',
						description: 'Category slug to scope before ranking',
					},
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 50,
						description: 'Max number of results to return',
					},
					{
						displayName: 'Platform',
						name: 'platform',
						type: 'string',
						default: '',
						description: 'Platform slug to scope before ranking',
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
				const discovery = customerSafeDiscovery.catalog(baseUrl);
				const apis = discovery.read(await this.helpers.httpRequest(discovery.request));

				const options = apis.map((a) => {
					const slug = String(a.slug ?? '');
					const name = String(a.name ?? slug);
					const price = customerSafeDiscovery.priceLabel(a.pricing);
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
		resourceMapping: {
			// Loads the selected SKU's input schema and exposes its properties as
			// typed Resource Mapper fields. Re-runs whenever the chosen API changes.
			async getApiInputSchema(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const sku = (this.getCurrentNodeParameter('sku') as string) || '';
				if (!sku) return { fields: [] };

				const baseUrl = await baseUrlFor(this);
				const discovery = customerSafeDiscovery.detail(baseUrl, sku);
				const api = discovery.read(
					await this.helpers.httpRequestWithAuthentication.call(
						this,
						'anyApiApi',
						discovery.request,
					),
				);

				const inputSchema = api.inputSchema as IDataObject;
				return { fields: schemaToResourceFields(inputSchema) };
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
					const inputMode = this.getNodeParameter('inputMode', i, 'fields') as string;
					let body: IDataObject = {};

					if (inputMode === 'json') {
						const rawInput = this.getNodeParameter('input', i, {}) as IDataObject | string;
						if (typeof rawInput === 'string') {
							body = rawInput.trim() === '' ? {} : (JSON.parse(rawInput) as IDataObject);
						} else {
							body = rawInput ?? {};
						}
					} else {
						const mapped = this.getNodeParameter('inputFields.value', i, {}) as IDataObject | null;
						for (const [k, v] of Object.entries(mapped ?? {})) {
							// Skip blanks so optional fields are omitted, not sent empty.
							if (v === undefined || v === null || v === '') continue;
							body[k] = v;
						}
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
					const discovery = customerSafeDiscovery.detail(baseUrl, sku);
					const api = discovery.read(
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'anyApiApi',
							discovery.request,
						),
					);
					responseData = api;
				} else if (operation === 'list') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const discovery = customerSafeDiscovery.browse(baseUrl, filters.category);
					responseData = discovery.read(
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'anyApiApi',
							discovery.request,
						),
					);
				} else if (operation === 'search') {
					const query = this.getNodeParameter('query', i) as string;
					const filters = this.getNodeParameter('searchFilters', i, {}) as IDataObject;
					const discovery = customerSafeDiscovery.search(baseUrl, query, filters);
					responseData = discovery.read(
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'anyApiApi',
							discovery.request,
						),
					);
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
