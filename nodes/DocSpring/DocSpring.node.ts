import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	docSpringApiRequest,
	flattenDelivery,
	schemaToResourceMapperFields,
} from './GenericFunctions';

export class DocSpring implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DocSpring',
		name: 'docSpring',
		icon: 'file:docspring.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate, combine, and sign PDFs with DocSpring',
		defaults: { name: 'DocSpring' },
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'docSpringApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Combined Submission', value: 'combinedSubmission' },
					{ name: 'Data Request', value: 'dataRequest' },
					{ name: 'Submission', value: 'submission' },
					{ name: 'Template', value: 'template' },
				],
				default: 'submission',
			},

			// ─── Operations ───────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['submission'] } },
				options: [
					{
						name: 'Generate PDF',
						value: 'generatePdf',
						action: 'Generate a PDF',
						description: 'Fill out a template and generate a PDF',
					},
					{ name: 'Get', value: 'get', action: 'Get a submission' },
					{ name: 'Get Many', value: 'getMany', action: 'Get many submissions' },
				],
				default: 'generatePdf',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['combinedSubmission'] } },
				options: [
					{
						name: 'Combine PDFs',
						value: 'combine',
						action: 'Combine PDF files',
						description: 'Merge submissions, templates, or files into one PDF',
					},
				],
				default: 'combine',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['template'] } },
				options: [
					{
						name: 'Search',
						value: 'search',
						action: 'Search templates',
						description: 'Find templates by name or ID',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['dataRequest'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a data request',
						description: 'Create a submission that waits for people to fill or sign it',
					},
					{
						name: 'Create Signing Link',
						value: 'createSigningLink',
						action: 'Create a signing link',
						description: 'Mint an authenticated link for a data request recipient',
					},
				],
				default: 'create',
			},

			// ─── Template picker (Generate PDF + Data Request → Create) ────
			{
				displayName: 'Template Name or ID',
				name: 'templateId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getTemplates' },
				required: true,
				default: '',
				displayOptions: {
					show: { resource: ['submission', 'dataRequest'], operation: ['generatePdf', 'create'] },
				},
			},

			// ─── Template data (dynamic per-template fields) ──────────────
			{
				displayName: 'Template Data',
				name: 'templateData',
				type: 'resourceMapper',
				default: { mappingMode: 'defineBelow', value: null },
				noDataExpression: true,
				typeOptions: {
					loadOptionsDependsOn: ['templateId'],
					resourceMapper: {
						resourceMapperMethod: 'getTemplateFields',
						mode: 'add',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						supportAutoMap: false,
					},
				},
				displayOptions: { show: { resource: ['submission'], operation: ['generatePdf'] } },
			},
			{
				displayName: 'Template Data',
				name: 'templateData',
				type: 'resourceMapper',
				default: { mappingMode: 'defineBelow', value: null },
				noDataExpression: true,
				typeOptions: {
					loadOptionsDependsOn: ['templateId'],
					resourceMapper: {
						resourceMapperMethod: 'getTemplateFieldsOptional',
						mode: 'add',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						supportAutoMap: false,
					},
				},
				displayOptions: { show: { resource: ['dataRequest'], operation: ['create'] } },
			},

			// ─── Generate PDF options ─────────────────────────────────────
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['submission'], operation: ['generatePdf'] } },
				options: [
					{
						displayName: 'Editable',
						name: 'editable',
						type: 'boolean',
						default: false,
						description: 'Whether the generated PDF form fields stay editable',
					},
					{
						displayName: 'Encrypt PDF With Passphrase',
						name: 'password',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description: 'Password used to encrypt and open the generated PDF',
					},
					{
						displayName: 'Expires in (Seconds)',
						name: 'expiresIn',
						type: 'number',
						default: 0,
						description: 'Seconds until the submission data and PDF are deleted',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'json',
						default: '{}',
						description: 'Custom metadata stored with the submission (JSON object)',
					},
					{
						displayName: 'Template Version',
						name: 'version',
						type: 'string',
						default: '',
						description: 'A specific published version, or "draft"',
					},
					{
						displayName: 'Test',
						name: 'test',
						type: 'boolean',
						default: false,
						description: 'Whether to generate a free, watermarked test PDF',
					},
				],
			},

			// ─── Submission: Get ──────────────────────────────────────────
			{
				displayName: 'Submission ID',
				name: 'submissionId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'sub_...',
				displayOptions: { show: { resource: ['submission'], operation: ['get'] } },
			},

			// ─── Submission: Get Many ─────────────────────────────────────
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['submission'], operation: ['getMany'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['submission'], operation: ['getMany'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['submission'], operation: ['getMany'] } },
				options: [
					{
						displayName: 'Mode',
						name: 'type',
						type: 'options',
						options: [
							{ name: 'Live', value: 'live' },
							{ name: 'Test', value: 'test' },
						],
						default: 'live',
					},
					{ displayName: 'Created After', name: 'created_after', type: 'dateTime', default: '' },
					{ displayName: 'Created Before', name: 'created_before', type: 'dateTime', default: '' },
				],
			},

			// ─── Combine PDFs ─────────────────────────────────────────────
			{
				displayName: 'Source PDFs',
				name: 'sourcePdfs',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: {},
				placeholder: 'Add Source PDF',
				displayOptions: { show: { resource: ['combinedSubmission'], operation: ['combine'] } },
				options: [
					{
						name: 'pdf',
						displayName: 'PDF',
						values: [
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'Combined Submission', value: 'combined_submission' },
									{ name: 'Custom File', value: 'custom_file' },
									{ name: 'Submission', value: 'submission' },
									{ name: 'Template', value: 'template' },
									{ name: 'URL', value: 'url' },
								],
								default: 'submission',
							},
							{
								displayName: 'ID',
								name: 'id',
								type: 'string',
								default: '',
								description: 'The resource ID (for every type except URL)',
								displayOptions: { hide: { type: ['url'] } },
							},
							{
								displayName: 'URL',
								name: 'url',
								type: 'string',
								default: '',
								description: 'The PDF URL (only when Type is URL)',
								displayOptions: { show: { type: ['url'] } },
							},
							{
								displayName: 'Template Version',
								name: 'template_version',
								type: 'string',
								default: '',
								displayOptions: { show: { type: ['template'] } },
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['combinedSubmission'], operation: ['combine'] } },
				options: [
					{
						displayName: 'Encrypt PDF With Passphrase',
						name: 'password',
						type: 'string',
						typeOptions: { password: true },
						default: '',
					},
					{ displayName: 'Expires in (Seconds)', name: 'expiresIn', type: 'number', default: 0 },
					{ displayName: 'Metadata', name: 'metadata', type: 'json', default: '{}' },
				],
			},

			// ─── Data Request: Create ─────────────────────────────────────
			{
				displayName: 'Recipients',
				name: 'dataRequests',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: {},
				placeholder: 'Add Recipient',
				displayOptions: { show: { resource: ['dataRequest'], operation: ['create'] } },
				options: [
					{
						name: 'recipient',
						displayName: 'Recipient',
						values: [
							{
								displayName: 'Email',
								name: 'email',
								type: 'string',
								placeholder: 'name@email.com',
								default: '',
								required: true,
							},
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{
								displayName: 'Fields',
								name: 'fields',
								type: 'string',
								default: '',
								description:
									'Comma-separated template field names this person must fill. Leave blank (single recipient) for all fields.',
							},
							{
								displayName: 'Authentication',
								name: 'auth_type',
								type: 'options',
								options: [
									{ name: 'Email Link (Recommended)', value: 'email_link' },
									{ name: 'Password', value: 'password' },
									{ name: 'OAuth', value: 'oauth' },
									{ name: 'Phone Number', value: 'phone_number' },
								],
								default: 'email_link',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['dataRequest'], operation: ['create'] } },
				options: [
					{ displayName: 'Test', name: 'test', type: 'boolean', default: false },
					{ displayName: 'Expires in (Seconds)', name: 'expiresIn', type: 'number', default: 0 },
					{ displayName: 'Metadata', name: 'metadata', type: 'json', default: '{}' },
					{ displayName: 'Template Version', name: 'version', type: 'string', default: '' },
				],
			},

			// ─── Data Request: Create Signing Link ────────────────────────
			{
				displayName: 'Data Request ID',
				name: 'dataRequestId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'drq_...',
				displayOptions: { show: { resource: ['dataRequest'], operation: ['createSigningLink'] } },
			},
			{
				displayName: 'Link Type',
				name: 'linkType',
				type: 'options',
				options: [
					{ name: 'Email (Expires in 30 Days)', value: 'email' },
					{ name: 'API (Expires in 1 Hour)', value: 'api' },
				],
				default: 'email',
				displayOptions: { show: { resource: ['dataRequest'], operation: ['createSigningLink'] } },
			},

			// ─── Template: Search ─────────────────────────────────────────
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Filter templates by name or ID',
				displayOptions: { show: { resource: ['template'], operation: ['search'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['template'], operation: ['search'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['template'], operation: ['search'], returnAll: [false] },
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const templates = (await docSpringApiRequest.call(this, 'GET', '/templates', {}, {
					per_page: 50,
				})) as IDataObject[];
				return (Array.isArray(templates) ? templates : []).map((t) => ({
					name: (t.name as string) || (t.id as string),
					value: t.id as string,
				}));
			},
		},
		resourceMapping: {
			async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const templateId = this.getNodeParameter('templateId', 0) as string;
				if (!templateId) return { fields: [] };
				const schema = (await docSpringApiRequest.call(
					this,
					'GET',
					`/templates/${templateId}/schema`,
				)) as IDataObject;
				return { fields: schemaToResourceMapperFields(schema, false) as any };
			},
			async getTemplateFieldsOptional(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const templateId = this.getNodeParameter('templateId', 0) as string;
				if (!templateId) return { fields: [] };
				const schema = (await docSpringApiRequest.call(
					this,
					'GET',
					`/templates/${templateId}/schema`,
				)) as IDataObject;
				return { fields: schemaToResourceMapperFields(schema, true) as any };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				if (resource === 'submission' && operation === 'generatePdf') {
					const templateId = this.getNodeParameter('templateId', i) as string;
					const mapper = this.getNodeParameter('templateData', i, {}) as {
						value?: IDataObject | null;
					};
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const body: IDataObject = {
						data: mapper?.value ?? {},
						test: options.test ?? false,
					};
					if (options.password) body.password = options.password;
					if (options.editable !== undefined) body.editable = options.editable;
					if (options.expiresIn) body.expires_in = options.expiresIn;
					if (options.version) body.version = options.version;
					if (options.metadata) body.metadata = parseJson.call(this, options.metadata as string, i);

					const result = (await docSpringApiRequest.call(
						this,
						'POST',
						`/templates/${templateId}/submissions`,
						body,
						{ wait: true },
						{ sync: true },
					)) as IDataObject;
					responseData = (result.submission as IDataObject) ?? result;
				} else if (resource === 'submission' && operation === 'get') {
					const submissionId = this.getNodeParameter('submissionId', i) as string;
					responseData = (await docSpringApiRequest.call(
						this,
						'GET',
						`/submissions/${submissionId}`,
					)) as IDataObject;
				} else if (resource === 'submission' && operation === 'getMany') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					responseData = await getSubmissions.call(this, filters, limit);
				} else if (resource === 'combinedSubmission' && operation === 'combine') {
					const rows =
						(this.getNodeParameter('sourcePdfs.pdf', i, []) as IDataObject[]) || [];
					const sourcePdfs = rows.map((row) => {
						const entry: IDataObject = { type: row.type || 'submission' };
						if (row.type === 'url') {
							entry.url = row.url;
						} else {
							entry.id = row.id;
						}
						if (row.template_version) entry.template_version = row.template_version;
						return entry;
					});
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const body: IDataObject = { source_pdfs: sourcePdfs };
					if (options.password) body.password = options.password;
					if (options.expiresIn) body.expires_in = options.expiresIn;
					if (options.metadata) body.metadata = parseJson.call(this, options.metadata as string, i);

					const result = (await docSpringApiRequest.call(
						this,
						'POST',
						'/combined_submissions',
						body,
						{ wait: true },
						{ sync: true },
					)) as IDataObject;
					responseData = (result.combined_submission as IDataObject) ?? result;
				} else if (resource === 'template' && operation === 'search') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const query = this.getNodeParameter('query', i, '') as string;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					responseData = await getTemplates.call(this, query, limit);
				} else if (resource === 'dataRequest' && operation === 'create') {
					responseData = await createDataRequest.call(this, i);
				} else if (resource === 'dataRequest' && operation === 'createSigningLink') {
					const dataRequestId = this.getNodeParameter('dataRequestId', i) as string;
					const linkType = this.getNodeParameter('linkType', i) as string;
					const result = (await docSpringApiRequest.call(
						this,
						'POST',
						`/data_requests/${dataRequestId}/tokens`,
						{},
						{ type: linkType },
					)) as IDataObject;
					const token = (result.token as IDataObject) ?? result;
					responseData = {
						id: token.id,
						signing_url: token.data_request_url,
						expires_at: token.expires_at,
					};
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject | IDataObject[]),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

// ─── helpers (module scope; called with the execute context) ────────────────

function parseJson(this: IExecuteFunctions, value: string, itemIndex: number): IDataObject {
	if (!value) return {};
	try {
		return typeof value === 'string' ? JSON.parse(value) : (value as IDataObject);
	} catch {
		throw new NodeOperationError(this.getNode(), 'Metadata must be a valid JSON object', {
			itemIndex,
		});
	}
}

async function getSubmissions(
	this: IExecuteFunctions,
	filters: IDataObject,
	limit: number,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const qs: IDataObject = { limit: 50, include_data: true, ...filters };
		if (cursor) qs.cursor = cursor;
		const page = (await docSpringApiRequest.call(this, 'GET', '/submissions', {}, qs)) as IDataObject;
		const submissions = (page.submissions as IDataObject[]) || [];
		results.push(...submissions);
		cursor = page.next_cursor as string | undefined;
		if (submissions.length === 0) break;
	} while (cursor && results.length < limit);
	return results.slice(0, limit === Infinity ? undefined : limit);
}

async function getTemplates(
	this: IExecuteFunctions,
	query: string,
	limit: number,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let page = 1;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const qs: IDataObject = { per_page: 50, page };
		if (query) qs.query = query;
		const batch = (await docSpringApiRequest.call(this, 'GET', '/templates', {}, qs)) as IDataObject[];
		const list = Array.isArray(batch) ? batch : [];
		results.push(...list);
		if (list.length < 50 || results.length >= limit) break;
		page += 1;
	}
	return results.slice(0, limit === Infinity ? undefined : limit);
}

function parseFields(value: unknown): string[] | undefined {
	if (value == null || value === '') return undefined;
	const arr = (Array.isArray(value) ? value : String(value).split(/[\n,]/))
		.map((s) => String(s).trim())
		.filter(Boolean);
	return arr.length ? arr : undefined;
}

async function createDataRequest(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const templateId = this.getNodeParameter('templateId', i) as string;
	const mapper = this.getNodeParameter('templateData', i, {}) as { value?: IDataObject | null };
	const rows = (this.getNodeParameter('dataRequests.recipient', i, []) as IDataObject[]) || [];
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const recipients = rows
		.filter((r) => r && r.email)
		.map((r) => {
			const entry: IDataObject = { email: r.email, auth_type: r.auth_type || 'email_link' };
			if (r.name) entry.name = r.name;
			const fields = parseFields(r.fields);
			if (fields) entry.fields = fields;
			return entry;
		});

	if (recipients.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one recipient with an email address', {
			itemIndex: i,
		});
	}

	const body: IDataObject = {
		data: mapper?.value ?? {},
		data_requests: recipients,
		test: options.test ?? false,
	};
	if (options.expiresIn) body.expires_in = options.expiresIn;
	if (options.version) body.version = options.version;
	if (options.metadata) body.metadata = parseJson.call(this, options.metadata as string, i);

	const result = (await docSpringApiRequest.call(
		this,
		'POST',
		`/templates/${templateId}/submissions`,
		body,
	)) as IDataObject;
	const submission = (result.submission as IDataObject) ?? result;
	const created = (submission.data_requests as IDataObject[]) || [];

	// Mint a 30-day email signing link per recipient (one failure shouldn't fail
	// the whole action).
	const enriched: IDataObject[] = [];
	for (const dr of created) {
		let signingUrl: string | null = null;
		if (dr.id && dr.state !== 'completed') {
			try {
				const tok = (await docSpringApiRequest.call(
					this,
					'POST',
					`/data_requests/${dr.id}/tokens`,
					{},
					{ type: 'email' },
				)) as IDataObject;
				signingUrl = ((tok.token as IDataObject)?.data_request_url as string) ?? null;
			} catch {
				signingUrl = null;
			}
		}
		enriched.push({ ...dr, signing_url: signingUrl });
	}

	const first = enriched[0] || {};
	return {
		...submission,
		data_requests: enriched,
		first_data_request_id: first.id ?? null,
		first_signing_url: first.signing_url ?? null,
	};
}

// re-export so the file is a module even if tree-shaken oddly
export { flattenDelivery };
