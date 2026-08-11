import type {
	IDataObject,
	INode,
	INodePropertyOptions,
	ResourceMapperField,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type MapperInput = {
	value?: IDataObject | null;
	schema?: ResourceMapperField[];
};

function schemaTypes(schema: IDataObject): string[] {
	if (Array.isArray(schema.type)) {
		return schema.type.filter((entry): entry is string => typeof entry === 'string');
	}
	return typeof schema.type === 'string' ? [schema.type] : [];
}

function nativeFieldType(schema: IDataObject): ResourceMapperField['type'] {
	const types = schemaTypes(schema);
	if (types.length !== 1 || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		return 'object';
	}
	if (types[0] === 'integer' || types[0] === 'number') return 'number';
	if (types[0] === 'boolean') return 'boolean';
	if (types[0] === 'array') return 'array';
	if (types[0] === 'object' || types[0] === 'null') return 'object';
	return 'string';
}

function scalarOptions(value: unknown): INodePropertyOptions[] | undefined {
	if (!Array.isArray(value)) return undefined;
	if (!value.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))) {
		return undefined;
	}
	return value.map((entry) => ({
		name: String(entry),
		value: entry as string | number | boolean,
	}));
}

export function schemaToResourceFields(schema: IDataObject): ResourceMapperField[] {
	const properties = (schema.properties as IDataObject) ?? {};
	const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
	return Object.entries(properties).map(([name, raw]) => {
		const property = (raw ?? {}) as IDataObject;
		const options = scalarOptions(property.enum);
		return {
			id: name,
			displayName: name,
			required: required.includes(name),
			defaultMatch: false,
			display: true,
			type: options ? 'options' : nativeFieldType(property),
			...(options ? { options } : {}),
		};
	});
}

function mapperError(node: INode, field: string, cause?: unknown): NodeOperationError {
	return new NodeOperationError(
		node,
		`Input field "${field}" must contain valid structured JSON in Fields mode. Use Input Mode "Raw JSON" for the full payload.`,
		cause === undefined ? undefined : { description: String(cause) },
	);
}

function structuredValue(value: unknown, field: string, node: INode): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw mapperError(node, field, error);
	}
}

export function decodeFieldsInput(value: unknown, node: INode): IDataObject {
	const mapper = (value ?? {}) as MapperInput;
	const mapped = mapper.value ?? {};
	const structured = new Set(
		(mapper.schema ?? [])
			.filter((field) => field.type === 'array' || field.type === 'object')
			.map((field) => field.id),
	);
	const body: IDataObject = {};
	for (const [field, raw] of Object.entries(mapped)) {
		if (raw === undefined || raw === '') continue;
		if (raw === null && !structured.has(field)) continue;
		body[field] = structured.has(field)
			? (structuredValue(raw, field, node) as IDataObject[string])
			: raw;
	}
	return body;
}

export function decodeRawInput(value: unknown, node: INode): IDataObject {
	let decoded = value;
	if (typeof value === 'string') {
		try {
			decoded = value.trim() === '' ? {} : (JSON.parse(value) as unknown);
		} catch (error) {
			throw new NodeOperationError(node, 'Input (JSON) must contain valid JSON.', {
				description: String(error),
			});
		}
	}
	if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
		throw new NodeOperationError(node, 'Input (JSON) must be a JSON object.');
	}
	return decoded as IDataObject;
}
