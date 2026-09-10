import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DocSpringApi implements ICredentialType {
	name = 'docSpringApi';

	displayName = 'DocSpring API';

	documentationUrl = 'https://docspring.com/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			options: [
				{ name: 'United States', value: 'us' },
				{ name: 'Europe', value: 'eu' },
				{ name: 'Self-Hosted / Enterprise', value: 'self_hosted' },
			],
			default: 'us',
			description: 'The region where your DocSpring account is hosted',
		},
		{
			displayName: 'Self-Hosted Host',
			name: 'customHost',
			type: 'string',
			default: '',
			placeholder: 'https://docspring.example.com',
			description:
				'Only for the Self-Hosted / Enterprise region. Your full DocSpring URL (https:// is added if you omit it).',
			displayOptions: {
				show: {
					region: ['self_hosted'],
				},
			},
		},
		{
			displayName: 'API Token ID',
			name: 'tokenId',
			type: 'string',
			default: '',
			description: 'From Settings → API Tokens in the DocSpring web app',
		},
		{
			displayName: 'API Token Secret',
			name: 'tokenSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];

	// HTTP Basic auth: Authorization: Basic base64(tokenId:tokenSecret).
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.tokenId}}',
				password: '={{$credentials.tokenSecret}}',
			},
		},
	};

	// Connection test against a region-dependent base URL.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.region === "self_hosted" ? ($credentials.customHost.includes("://") ? $credentials.customHost : "https://" + $credentials.customHost) : ($credentials.region === "eu" ? "https://api-eu.docspring.com" : "https://api.docspring.com")}}/api/v1',
			url: '/authentication',
			method: 'GET',
		},
	};
}
