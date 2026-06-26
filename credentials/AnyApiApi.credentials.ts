import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// AnyApiApi holds a single AnyAPI key. AnyAPI authenticates every request with a
// Bearer token, so the key is injected as `Authorization: Bearer <key>`. The Base
// URL is configurable only for self-hosted or staging gateways; the default is
// the public gateway.
export class AnyApiApi implements ICredentialType {
	name = 'anyApiApi';

	displayName = 'AnyAPI API';

	documentationUrl = 'https://getanyapi.com/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your AnyAPI key. Create one at getanyapi.com/dashboard.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.getanyapi.com',
			description: 'The AnyAPI gateway base URL. Change only for self-hosted or staging.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Validates the key on save by reading the wallet balance.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/balance',
		},
	};
}
