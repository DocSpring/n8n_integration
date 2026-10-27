import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

// The template picker: search the account's templates (paged by cursor), or enter an ID.
export function templateLocator(show: Show, options: { required?: boolean; description?: string } = {}): INodeProperties {
	const property: INodeProperties = {
		displayName: 'Template',
		name: 'templateId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description: options.description,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTemplates', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'tpl_1234567890abcdef01',
			},
		],
		displayOptions: { show },
	};
	if (options.required !== false) property.required = true;
	if (!options.description) delete property.description;
	return property;
}

// The template version for operations that create or check a submission. API v2 uses the latest published
// version when it's left out (the draft when none has been published).
export function submissionTemplateVersion(show: Show): INodeProperties {
	return {
		displayName: 'Template Version',
		name: 'templateVersion',
		type: 'string',
		default: '',
		placeholder: 'latest',
		description:
			'Leave empty for the latest published version (the draft when none has been published). Enter "draft", "latest", a version such as 1.2.0, or 1 for the latest 1.x.x.',
		displayOptions: { show },
	};
}

// The template version for operations that read a template. API v2 reads the draft when it's left out.
export function readTemplateVersion(show: Show): INodeProperties {
	return {
		displayName: 'Template Version',
		name: 'templateVersion',
		type: 'string',
		default: '',
		placeholder: 'draft',
		description:
			'Leave empty for the draft. Enter "latest", a published version such as 1.2.0, or 1 for the latest 1.x.x.',
		displayOptions: { show },
	};
}

// The template's data, with a field for each of the template's fields (from its JSON Schema at the chosen version).
export function templateDataMapper(show: Show, allOptional: boolean): INodeProperties {
	return {
		displayName: 'Template Data',
		name: 'templateData',
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		noDataExpression: true,
		typeOptions: {
			loadOptionsDependsOn: ['templateId.value', 'templateVersion'],
			resourceMapper: {
				resourceMapperMethod: allOptional ? 'getTemplateFieldsOptional' : 'getTemplateFields',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: true,
				supportAutoMap: false,
				showTypeConversionOptions: true,
			},
		},
		displayOptions: { show },
	};
}

export function testField(show: Show): INodeProperties {
	return {
		displayName: 'Test',
		name: 'test',
		type: 'boolean',
		default: false,
		description:
			'Whether to make a test submission. Test PDFs have a watermark and are free; live PDFs use credits. A test API token only makes test submissions.',
		displayOptions: { show },
	};
}

// The people who sign the PDF and fill in their fields first. Required to create a signature request; optional
// for Check Data.
export function signersField(show: Show, required: boolean): INodeProperties {
	const property: INodeProperties = {
		displayName: 'Signers',
		name: 'signers',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		placeholder: 'Add Signer',
		description: required
			? 'The people who sign the PDF. Each one fills in their own fields.'
			: 'Signers to check, as Create Signature Request would send them',
		displayOptions: { show },
		options: [
			{
				name: 'signer',
				displayName: 'Signer',
				values: [
					{
						displayName: 'Auth Provider',
						name: 'authProvider',
						type: 'string',
						default: '',
						placeholder: 'google',
						description: 'The service that signed the person in, such as google. Required for OAuth.',
						displayOptions: { show: { authType: ['oauth'] } },
					},
					{
						displayName: 'Authentication',
						name: 'authType',
						type: 'options',
						options: [
							{ name: 'Email Link', value: 'email_link' },
							{ name: 'LDAP', value: 'ldap' },
							{ name: 'OAuth', value: 'oauth' },
							{ name: 'Password', value: 'password' },
							{ name: 'Phone Number', value: 'phone_number' },
							{ name: 'SAML', value: 'saml' },
						],
						default: 'email_link',
						description: 'How your app checked who the person is before it showed them the signature request',
					},
					{
						displayName: 'Email',
						name: 'email',
						type: 'string',
						placeholder: 'name@email.com',
						default: '',
					},
					{
						displayName: 'Field Names or IDs',
						name: 'fields',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getTemplateFieldNames',
							loadOptionsDependsOn: ['templateId.value', 'templateVersion'],
						},
						default: [],
						description:
							'The fields this person fills in (at least one; each field in only one signer). Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Ignore Unknown Fields',
						name: 'ignoreUnknownFields',
						type: 'boolean',
						default: false,
						description: "Whether to leave out field names the template doesn't have, instead of failing",
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Prefilled Values Editable',
						name: 'prefilledValuesEditable',
						type: 'boolean',
						default: false,
						description: 'Whether the person can change values that Template Data already fills in for their fields',
					},
					{
						displayName: 'Role',
						name: 'role',
						type: 'string',
						default: '',
						placeholder: 'Signer 1',
						description:
							"Which of the template's signers the person is (Signer 1, Signer 2, …). Set it for every signer or for none.",
					},
				],
			},
		],
	};
	if (required) property.required = true;
	return property;
}

// Where a template's PDF comes from: a binary property of the input item, or an https:// URL.
export function documentSourceFields(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'PDF Source',
			name: 'documentSource',
			type: 'options',
			options: [
				{ name: 'Binary File', value: 'binary', description: "A PDF in the input item's binary data" },
				{ name: 'URL', value: 'url', description: 'An https:// link that DocSpring downloads the PDF from' },
			],
			default: 'binary',
			displayOptions: { show },
		},
		{
			displayName: 'Input Binary Field',
			name: 'binaryPropertyName',
			type: 'string',
			default: 'data',
			required: true,
			hint: 'The name of the input binary field that holds the PDF (up to 7 MB)',
			displayOptions: { show: { ...show, documentSource: ['binary'] } },
		},
		{
			displayName: 'PDF URL',
			name: 'documentUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://example.com/form.pdf',
			description: 'An https:// link to the PDF (up to 100 MB)',
			displayOptions: { show: { ...show, documentSource: ['url'] } },
		},
	];
}

export function folderOptionsField(
	displayName: string,
	name: string,
	description: string,
	withRoot: boolean,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'options',
		typeOptions: { loadOptionsMethod: withRoot ? 'getFoldersWithRoot' : 'getFolders' },
		default: '',
		description: `${description}. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.`,
	};
}

export function returnAllAndLimit(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
		},
	];
}

export function waitOption(displayName: string, description: string): INodeProperties {
	return {
		displayName,
		name: 'wait',
		type: 'boolean',
		default: true,
		description,
	};
}

export const metadataOption: INodeProperties = {
	displayName: 'Metadata',
	name: 'metadata',
	type: 'json',
	default: '{}',
	description: 'Your own data to store with the record, such as an ID from your app (a JSON object)',
};

export const expiresInOption: INodeProperties = {
	displayName: 'Expires In (Seconds)',
	name: 'expiresIn',
	type: 'number',
	typeOptions: { minValue: 1 },
	default: 86400,
	description: 'Seconds after the PDF is generated until its data and PDF are deleted',
};

export const passwordOption: INodeProperties = {
	displayName: 'Encrypt PDF With Passphrase',
	name: 'password',
	type: 'string',
	typeOptions: { password: true },
	default: '',
	description: 'A passphrase that the PDF needs to be opened with',
};
