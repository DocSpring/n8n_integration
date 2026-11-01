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

// Who sends the signers their links: DocSpring emails them (the API's default) or you send the links yourself. Create
// Signature Request and Check Data both offer it, so a check covers what Create sends. DocSpring's email options show
// only with its emails: the API refuses them when it emails nobody.
export function signerEmailFields(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'Emails to Signers',
			name: 'sendEmail',
			type: 'options',
			options: [
				{
					name: 'DocSpring Emails Each Signer Their Link',
					value: 'docspring',
					description: 'With any reminders, and the signed PDF once everyone has signed',
				},
				{
					name: 'I Send the Links, or Open Them in My App',
					value: 'self',
					description: 'For people you send the link to yourself or who sign in your app',
				},
			],
			default: 'docspring',
			description:
				"DocSpring emails each signer a link to sign, any reminders, and the signed PDF once everyone has signed. A test submission only emails members of your DocSpring team. DocSpring doesn't email the signers of a form library template: choose I send the links for one.",
			displayOptions: { show },
		},
		{
			displayName: 'Signing Order',
			name: 'signingOrder',
			type: 'options',
			options: [
				{ name: 'Everyone at Once', value: 'parallel' },
				{ name: 'One Step at a Time', value: 'sequential' },
			],
			default: 'parallel',
			description:
				"One step at a time: people sign in the order of their Signing Step, or of the Signers list. DocSpring emails each step when the one before it is done; when you send the links, send each step's once the step before it has signed.",
			displayOptions: { show },
		},
		{
			displayName: 'Email Options',
			name: 'emailOptions',
			type: 'collection',
			placeholder: 'Add Email Option',
			default: {},
			displayOptions: { show: { ...show, sendEmail: ['docspring'] } },
			options: [
				{
					displayName: 'CC',
					name: 'cc',
					type: 'string',
					default: '',
					placeholder: 'records@example.com',
					description: "Up to 10 people who get the signed PDF, separated by commas. They don't sign.",
				},
				{
					displayName: 'Email Subject',
					name: 'emailSubject',
					type: 'string',
					default: '',
					description:
						'The subject of the emails that ask people to sign. Leave it empty for "&lt;your name&gt; sent you &lt;document&gt; to sign".',
				},
				{
					displayName: 'Message',
					name: 'emailMessage',
					type: 'string',
					typeOptions: { rows: 4 },
					default: '',
					description:
						'A message for the signers, shown above the signing button. Links and web addresses are shown as plain text.',
				},
				{
					displayName: 'Notification Emails',
					name: 'notificationEmails',
					type: 'string',
					default: '',
					description:
						"Up to 10 addresses, separated by commas, that DocSpring tells when the document is completed or declined, or an email bounces or can't be sent: members of your DocSpring team or addresses at your verified email domains. Leave it empty for the template's notification addresses (the account owner when it has none).",
				},
				{
					displayName: 'Notify When Each Person Signs',
					name: 'notifyWhenSigned',
					type: 'boolean',
					default: false,
					description: 'Whether to also email the notification addresses each time someone signs',
				},
				{
					displayName: 'Reminders',
					name: 'reminders',
					type: 'fixedCollection',
					default: {},
					placeholder: 'Add Reminders',
					description: "Remind people who haven't signed",
					options: [
						{
							name: 'reminder',
							displayName: 'Reminder',
							values: [
								{
									displayName: 'Days Between Reminders',
									name: 'intervalDays',
									type: 'number',
									typeOptions: { minValue: 1, maxValue: 30 },
									default: 3,
								},
								{
									displayName: 'Most Reminders per Person',
									name: 'maxCount',
									type: 'number',
									typeOptions: { minValue: 1, maxValue: 10 },
									default: 2,
								},
							],
						},
					],
				},
				{
					displayName: 'Reply-To Address',
					name: 'replyTo',
					type: 'string',
					default: '',
					placeholder: 'name@email.com',
					description:
						"Where replies to the emails go: a member of your DocSpring team, or an address at one of your verified email domains. Leave it empty for the template's reply-to address (the account owner when it has none).",
				},
			],
		},
	];
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
						description:
							"How the person is identified before they see the form. Choose Email Link when they get their link by email, from DocSpring or from you: DocSpring's emails always use it. The other types are for people you send the link to yourself or who sign in your app.",
					},
					{
						displayName: 'Email',
						name: 'email',
						type: 'string',
						placeholder: 'name@email.com',
						default: '',
						description: 'Required when DocSpring emails the signers',
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
					{
						displayName: 'Signing Step',
						name: 'signingStep',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 100 },
						default: 0,
						description:
							'With Signing Order One Step at a Time: when this person signs. Everyone in step 1 signs first, then step 2, and so on, and people in the same step sign in any order. Give every signer a step, or leave them all at 0 to have them sign in the order of the Signers list.',
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
