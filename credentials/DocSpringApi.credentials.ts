import type {
	Icon,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { NO_API_V2_MESSAGE, USER_AGENT } from '../nodes/DocSpring/version';

export class DocSpringApi implements ICredentialType {
	name = 'docSpringApi';

	displayName = 'DocSpring API';

	icon: Icon = { light: 'file:docspring.svg', dark: 'file:docspring.dark.svg' };

	documentationUrl = 'https://docspring.com/docs/api-guide/authentication/';

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
				'Only for the Self-Hosted / Enterprise region. Your DocSpring URL (https:// is added if you leave it out). The server needs a DocSpring release with API v2.',
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
			typeOptions: { password: true },
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

	// HTTP Basic auth (token ID as the username, secret as the password), plus a User-Agent that names this
	// package. n8n applies this to every request made with the credential, including the HTTP Request node's
	// ("Predefined Credential Type" → DocSpring API), so any API v2 endpoint can be called with it.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.tokenId}}',
				password: '={{$credentials.tokenSecret}}',
			},
			headers: {
				'User-Agent': USER_AGENT,
			},
		},
	};

	// GET /api/v2/authentication returns {"authenticated": true}. A self-hosted server without API v2 returns a 404.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.region === "self_hosted" ? ($credentials.customHost.trim().includes("://") ? $credentials.customHost.trim() : "https://" + $credentials.customHost.trim()).replace(/\\/+$/, "") : ($credentials.region === "eu" ? "https://api-eu.docspring.com" : "https://api.docspring.com")}}/api/v2',
			url: '/authentication',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: { value: 404, message: NO_API_V2_MESSAGE },
			},
		],
	};
}
