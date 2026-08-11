import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { customerSafeDiscovery } from './discovery';
import { nodeProperties } from './nodeProperties';
import { baseUrlFor, executeAnyApi } from './requestExecution';
import { schemaToResourceFields } from './schemaCodec';

export class AnyApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AnyAPI',
		name: 'anyApi',
		icon: { light: 'file:anyapi.svg', dark: 'file:anyapi.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ $parameter["operation"] + ($parameter["sku"] ? ": " + $parameter["sku"] : "") }}',
		description: 'Run any scraping or data API through AnyAPI, billed per request in USD',
		usableAsTool: true,
		defaults: { name: 'AnyAPI' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'anyApiApi', required: true }],
		properties: nodeProperties,
	};

	methods = {
		loadOptions: {
			async getSkus(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const baseUrl = await baseUrlFor(this);
				const discovery = customerSafeDiscovery.catalog(baseUrl);
				const apis = discovery.read(await this.helpers.httpRequest(discovery.request));
				const options = apis.map((api) => {
					const slug = String(api.slug ?? '');
					return {
						name: `${String(api.name ?? slug)}${customerSafeDiscovery.priceLabel(api.pricing)}`,
						value: slug,
						description: String(api.description ?? ''),
					} as INodePropertyOptions;
				});
				options.sort((left, right) => left.name.localeCompare(right.name));
				return options;
			},
		},
		resourceMapping: {
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
				return { fields: schemaToResourceFields(api.inputSchema as IDataObject) };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return executeAnyApi.call(this);
	}
}
