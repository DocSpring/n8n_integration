import type { INodeProperties } from 'n8n-workflow';

import {
	expiresInOption,
	metadataOption,
	signersField,
	submissionTemplateVersion,
	templateDataMapper,
	templateLocator,
	testField,
} from './SharedDescription';

export const signatureRequestOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['signatureRequest'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a signature request',
				description: 'Create a submission that waits for people to fill in and sign it, with a signing link for each',
			},
			{
				name: 'Create Signing Link',
				value: 'createSigningLink',
				action: 'Create a signing link',
				description: 'Create a link that opens a signature request',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a signature request',
				description: 'Get a signature request by ID',
			},
		],
		default: 'create',
	},
];

const create = { resource: ['signatureRequest'], operation: ['create'] };

export const signatureRequestFields: INodeProperties[] = [
	// ─── Create ───────────────────────────────────────────────────────────
	templateLocator(create),
	submissionTemplateVersion(create),
	templateDataMapper(create, true),
	signersField(create, true),
	{
		displayName: 'Signing Links',
		name: 'signingLinkType',
		type: 'options',
		options: [
			{
				name: 'API Link (Expires in 24 Hours)',
				value: 'api',
				description: 'For a form your app opens, or a link it gives the person straight away',
			},
			{ name: 'Email Link (Expires in 7 Days)', value: 'email', description: 'For a link you send by email' },
			{ name: 'None', value: 'none', description: "Don't create signing links" },
		],
		default: 'email',
		description:
			'The signing link to create for each signer, added to the output as signing_url. A form that opened in time keeps working for 7 more days.',
		displayOptions: { show: create },
	},
	testField(create),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: create },
		options: [expiresInOption, metadataOption],
	},

	// ─── Create Signing Link and Get ──────────────────────────────────────
	{
		displayName: 'Signature Request ID',
		name: 'signatureRequestId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'srq_1234567890abcdef01',
		displayOptions: { show: { resource: ['signatureRequest'], operation: ['createSigningLink', 'get'] } },
	},
	{
		displayName: 'Link Type',
		name: 'linkType',
		type: 'options',
		options: [
			{
				name: 'API Link (Expires in 24 Hours)',
				value: 'api',
				description: 'For a form your app opens, or a link it gives the person straight away',
			},
			{ name: 'Email Link (Expires in 7 Days)', value: 'email', description: 'For a link you send by email' },
		],
		default: 'email',
		description: 'The link is the token\'s signature_request_url. A form that opened in time keeps working for 7 more days.',
		displayOptions: { show: { resource: ['signatureRequest'], operation: ['createSigningLink'] } },
	},
];
