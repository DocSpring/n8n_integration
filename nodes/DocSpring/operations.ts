import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ApiRequest, ErrorText, RecordKind } from './GenericFunctions';
import {
	MAX_BASE64_DOCUMENT_BYTES,
	ROOT_FOLDER,
	docSpringApiRequest,
	docSpringApiRequestAllItems,
	encodeId,
	errorText,
	generatedFilesFailure,
	parseIntegerList,
	parseJsonArrayOfObjects,
	parseJsonObject,
	parseList,
	recordFailure,
	toBoolean,
	toInteger,
	toRfc3339,
	withoutEmptyValues,
} from './GenericFunctions';

type Result = IDataObject | IDataObject[];
type Operation = (this: IExecuteFunctions, i: number) => Promise<Result>;

// ─── Parameter helpers ────────────────────────────────────────────────────────

function stringParam(ctx: IExecuteFunctions, name: string, i: number): string {
	const value = ctx.getNodeParameter(name, i, '') as unknown;
	return value === undefined || value === null ? '' : String(value).trim();
}

function requiredString(ctx: IExecuteFunctions, name: string, label: string, i: number): string {
	const value = stringParam(ctx, name, i);
	if (!value) throw new NodeOperationError(ctx.getNode(), `Enter the ${label}`, { itemIndex: i });
	return value;
}

function templateIdParam(ctx: IExecuteFunctions, i: number, required = true): string {
	const value = ctx.getNodeParameter('templateId', i, '', { extractValue: true }) as unknown;
	const id = value === undefined || value === null ? '' : String(value).trim();
	if (!id && required) throw new NodeOperationError(ctx.getNode(), 'Choose a template', { itemIndex: i });
	return id;
}

function optionsParam(ctx: IExecuteFunctions, i: number, name = 'options'): IDataObject {
	return (ctx.getNodeParameter(name, i, {}) as IDataObject) || {};
}

function versionQuery(ctx: IExecuteFunctions, i: number): IDataObject {
	const version = stringParam(ctx, 'templateVersion', i);
	return version ? { version } : {};
}

function waitQuery(ctx: IExecuteFunctions, options: IDataObject, i: number): IDataObject {
	const wait = options.wait === undefined ? true : toBoolean(options.wait, 'Wait', ctx.getNode(), i);
	return { wait };
}

function throwFailure(ctx: IExecuteFunctions, failure: ErrorText | undefined, i: number): void {
	if (failure) {
		throw new NodeOperationError(ctx.getNode(), failure.message, { itemIndex: i, description: failure.description });
	}
}

// An ID for a URL path: encoded, and never "." or "..".
function pathId(ctx: IExecuteFunctions, id: string, label: string, i: number): string {
	return encodeId(id, label, ctx.getNode(), i);
}

async function request(ctx: IExecuteFunctions, apiRequest: ApiRequest, i: number): Promise<any> {
	return docSpringApiRequest.call(ctx, apiRequest, i);
}

// Creates a record and fails when it comes back in a failure state.
async function create(ctx: IExecuteFunctions, apiRequest: ApiRequest, kind: RecordKind, i: number): Promise<IDataObject> {
	const record = (await request(ctx, apiRequest, i)) as IDataObject;
	throwFailure(ctx, recordFailure(kind, record), i);
	return record;
}

// The template data from the resource mapper, without the fields left empty.
function templateData(ctx: IExecuteFunctions, i: number): IDataObject {
	const mapper = ctx.getNodeParameter('templateData', i, {}) as { value?: IDataObject | null };
	return withoutEmptyValues(mapper?.value);
}

function testBody(ctx: IExecuteFunctions, i: number): IDataObject {
	// API v2 rejects `test: false` from a test API token, so `test` is only sent when it's true.
	return toBoolean(ctx.getNodeParameter('test', i, false), 'Test', ctx.getNode(), i) ? { test: true } : {};
}

function commonSubmissionOptions(ctx: IExecuteFunctions, options: IDataObject, i: number): IDataObject {
	const node = ctx.getNode();
	const body: IDataObject = {};
	if (options.editable !== undefined) body.editable = toBoolean(options.editable, 'Editable', node, i);
	if (options.password) body.password = String(options.password);
	const expiresIn = toInteger(options.expiresIn, 'Expires In', node, i);
	if (expiresIn !== undefined) body.expires_in = expiresIn;
	const fieldOverrides = parseJsonObject(options.fieldOverrides, 'Field Overrides', node, i);
	if (fieldOverrides) body.field_overrides = fieldOverrides;
	const metadata = parseJsonObject(options.metadata, 'Metadata', node, i);
	if (metadata) body.metadata = metadata;
	const outputFormats = parseList(options.outputFormats);
	if (outputFormats.length) body.output_formats = outputFormats;
	return body;
}

// The Signers collection as API v2 signature requests. Each one needs fields and an auth type, and OAuth needs a
// provider. Optional values left empty aren't sent.
function signatureRequests(ctx: IExecuteFunctions, i: number, required: boolean): IDataObject[] | undefined {
	const node = ctx.getNode();
	const rows = (ctx.getNodeParameter('signers.signer', i, []) as IDataObject[]) || [];
	if (rows.length === 0) {
		if (required) throw new NodeOperationError(node, 'Add at least one signer', { itemIndex: i });
		return undefined;
	}
	return rows.map((row, index) => {
		const signer = `Signer ${index + 1}`;
		const fields = parseList(row.fields);
		if (fields.length === 0) {
			throw new NodeOperationError(node, `Choose the fields that ${signer} fills in`, { itemIndex: i });
		}
		const authType = String(row.authType || 'email_link');
		const entry: IDataObject = { fields, auth_type: authType };
		for (const [key, apiKey] of [
			['name', 'name'],
			['email', 'email'],
			['role', 'role'],
		]) {
			const value = row[key] === undefined || row[key] === null ? '' : String(row[key]).trim();
			if (value) entry[apiKey] = value;
		}
		if (authType === 'oauth') {
			const provider = row.authProvider === undefined ? '' : String(row.authProvider).trim();
			if (!provider) {
				throw new NodeOperationError(node, `${signer} uses OAuth: enter its Auth Provider, such as google`, {
					itemIndex: i,
				});
			}
			entry.auth_provider = provider;
		}
		if (toBoolean(row.prefilledValuesEditable, 'Prefilled Values Editable', node, i)) {
			entry.prefilled_values_editable = true;
		}
		if (toBoolean(row.ignoreUnknownFields, 'Ignore Unknown Fields', node, i)) entry.ignore_unknown_fields = true;
		return entry;
	});
}

// A template's PDF: base64 from an input binary field, or an https:// URL.
async function documentBody(ctx: IExecuteFunctions, i: number, options: IDataObject): Promise<IDataObject> {
	const node = ctx.getNode();
	const body: IDataObject = {};
	if (stringParam(ctx, 'documentSource', i) === 'url') {
		body.document_url = requiredString(ctx, 'documentUrl', 'PDF URL', i);
	} else {
		const propertyName = requiredString(ctx, 'binaryPropertyName', 'Input Binary Field', i);
		const binary = ctx.helpers.assertBinaryData(i, propertyName);
		const buffer = await ctx.helpers.getBinaryDataBuffer(i, propertyName);
		if (buffer.length > MAX_BASE64_DOCUMENT_BYTES) {
			throw new NodeOperationError(
				node,
				`The PDF is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. A PDF from a binary file can be up to 7 MB: use a PDF URL for a larger one.`,
				{ itemIndex: i },
			);
		}
		body.document_base64 = buffer.toString('base64');
		body.filename = binary.fileName || 'document.pdf';
	}
	const filename = options.filename === undefined ? '' : String(options.filename).trim();
	if (filename) body.filename = filename;
	return body;
}

function folderValue(value: unknown): string | null | undefined {
	const id = value === undefined || value === null ? '' : String(value).trim();
	if (!id) return undefined;
	return id === ROOT_FOLDER ? null : id;
}

async function list(ctx: IExecuteFunctions, apiRequest: ApiRequest, i: number): Promise<IDataObject[]> {
	const returnAll = toBoolean(ctx.getNodeParameter('returnAll', i, false), 'Return All', ctx.getNode(), i);
	const limit = returnAll ? Infinity : (toInteger(ctx.getNodeParameter('limit', i, 50), 'Limit', ctx.getNode(), i) ?? 50);
	return docSpringApiRequestAllItems.call(ctx, apiRequest, limit, i);
}

// ─── Submissions ──────────────────────────────────────────────────────────────

const generatePdf: Operation = async function (i) {
	const templateId = templateIdParam(this, i);
	const options = optionsParam(this, i);
	const body: IDataObject = {
		data: templateData(this, i),
		...testBody(this, i),
		...commonSubmissionOptions(this, options, i),
	};
	return create(
		this,
		{
			method: 'POST',
			path: `/templates/${pathId(this, templateId, 'Template ID', i)}/submissions`,
			qs: { ...versionQuery(this, i), ...waitQuery(this, options, i) },
			body,
			sync: true,
		},
		'submission',
		i,
	);
};

const checkData: Operation = async function (i) {
	const templateId = templateIdParam(this, i);
	const body: IDataObject = { data: templateData(this, i), ...testBody(this, i) };
	const signers = signatureRequests(this, i, false);
	if (signers) body.signature_requests = signers;
	return request(
		this,
		{
			method: 'POST',
			path: `/templates/${pathId(this, templateId, 'Template ID', i)}/submissions/validate`,
			qs: versionQuery(this, i),
			body,
		},
		i,
	);
};

const getSubmission: Operation = async function (i) {
	const id = requiredString(this, 'submissionId', 'Submission ID', i);
	return request(this, { method: 'GET', path: `/submissions/${pathId(this, id, 'Submission ID', i)}` }, i);
};

const expireSubmission: Operation = async function (i) {
	const id = requiredString(this, 'submissionId', 'Submission ID', i);
	return request(this, { method: 'DELETE', path: `/submissions/${pathId(this, id, 'Submission ID', i)}` }, i);
};

const generateFiles: Operation = async function (i) {
	const id = requiredString(this, 'submissionId', 'Submission ID', i);
	const formats = parseList(this.getNodeParameter('formats', i, []));
	if (formats.length === 0) throw new NodeOperationError(this.getNode(), 'Choose at least one format', { itemIndex: i });
	const options = optionsParam(this, i);
	const submission = (await request(
		this,
		{
			method: 'POST',
			path: `/submissions/${pathId(this, id, 'Submission ID', i)}/generate_files`,
			qs: waitQuery(this, options, i),
			body: { formats },
			sync: true,
		},
		i,
	)) as IDataObject;
	throwFailure(this, generatedFilesFailure(submission, formats), i);
	return submission;
};

const getManySubmissions: Operation = async function (i) {
	const node = this.getNode();
	const filters = optionsParam(this, i, 'filters');
	const qs: IDataObject = {};
	const templateId = templateIdParam(this, i, false);
	if (templateId) qs.template_id = templateId;
	if (filters.mode === 'live' || filters.mode === 'test') qs.test = filters.mode === 'test';
	const timeZone = this.getTimezone();
	const createdAfter = toRfc3339(filters.createdAfter, timeZone, 'Created After', node, i);
	if (createdAfter) qs.created_after = createdAfter;
	const createdBefore = toRfc3339(filters.createdBefore, timeZone, 'Created Before', node, i);
	if (createdBefore) qs.created_before = createdBefore;
	if (toBoolean(filters.includeData, 'Include Data', node, i)) qs.include_data = true;
	return list(this, { method: 'GET', path: '/submissions', qs }, i);
};

// ─── Submission batches ───────────────────────────────────────────────────────

const createSubmissionBatch: Operation = async function (i) {
	const node = this.getNode();
	const options = optionsParam(this, i);
	const body: IDataObject = { template_id: templateIdParam(this, i) };
	const version = stringParam(this, 'templateVersion', i);
	if (version) body.template_version = version;
	Object.assign(body, testBody(this, i));
	const outputFormats = parseList(options.outputFormats);
	if (outputFormats.length) body.output_formats = outputFormats;
	const metadata = parseJsonObject(options.metadata, 'Metadata', node, i);
	if (metadata) body.metadata = metadata;
	body.submissions = parseJsonArrayOfObjects(
		this.getNodeParameter('submissions', i),
		'Submissions',
		node,
		i,
		'submissions',
	);
	return create(
		this,
		{ method: 'POST', path: '/submissions/batches', qs: waitQuery(this, options, i), body, sync: true },
		'submissionBatch',
		i,
	);
};

const getSubmissionBatch: Operation = async function (i) {
	const id = requiredString(this, 'submissionBatchId', 'Submission Batch ID', i);
	const options = optionsParam(this, i);
	const qs: IDataObject = {};
	if (toBoolean(options.includeData, 'Include Data', this.getNode(), i)) qs.include_data = true;
	return request(this, { method: 'GET', path: `/submissions/batches/${pathId(this, id, 'Submission Batch ID', i)}`, qs }, i);
};

// ─── Combined PDFs ────────────────────────────────────────────────────────────

const combinePdfs: Operation = async function (i) {
	const node = this.getNode();
	const rows = (this.getNodeParameter('sourcePdfs.pdf', i, []) as IDataObject[]) || [];
	if (rows.length === 0) throw new NodeOperationError(node, 'Add at least one source PDF', { itemIndex: i });
	// Each source takes only its type's properties: API v2 rejects any other.
	const sourcePdfs = rows.map((row, index) => {
		const type = String(row.type || 'submission');
		const value = (key: string) => (row[key] === undefined || row[key] === null ? '' : String(row[key]).trim());
		if (type === 'url') {
			if (!value('url')) throw new NodeOperationError(node, `Enter the URL of source PDF ${index + 1}`, { itemIndex: i });
			return { type, url: value('url') };
		}
		if (!value('id')) throw new NodeOperationError(node, `Enter the ID of source PDF ${index + 1}`, { itemIndex: i });
		const source: IDataObject = { type, id: value('id') };
		if (type === 'template') {
			if (value('templateVersion')) source.template_version = value('templateVersion');
			if (row.processed !== undefined && !toBoolean(row.processed, 'Processed PDF', node, i)) source.processed = false;
		}
		return source;
	});
	const options = optionsParam(this, i);
	const body: IDataObject = { source_pdfs: sourcePdfs };
	if (options.password) body.password = String(options.password);
	const expiresIn = toInteger(options.expiresIn, 'Expires In', node, i);
	if (expiresIn !== undefined) body.expires_in = expiresIn;
	const metadata = parseJsonObject(options.metadata, 'Metadata', node, i);
	if (metadata) body.metadata = metadata;
	return create(
		this,
		{ method: 'POST', path: '/combined_pdfs', qs: waitQuery(this, options, i), body, sync: true },
		'combinedPdf',
		i,
	);
};

const getCombinedPdf: Operation = async function (i) {
	const id = requiredString(this, 'combinedPdfId', 'Combined PDF ID', i);
	return request(this, { method: 'GET', path: `/combined_pdfs/${pathId(this, id, 'Combined PDF ID', i)}` }, i);
};

// ─── Signature requests ───────────────────────────────────────────────────────

// Creates a submission with signature requests on the standard host (it waits for people, not for a PDF), then
// a signing link for each signature request. Adds each one's `signing_url`, and `first_signature_request_id` and
// `first_signing_url` for workflows with one signer.
const createSignatureRequest: Operation = async function (i) {
	const templateId = templateIdParam(this, i);
	const options = optionsParam(this, i);
	const body: IDataObject = {
		data: templateData(this, i),
		signature_requests: signatureRequests(this, i, true),
		...testBody(this, i),
	};
	const node = this.getNode();
	const expiresIn = toInteger(options.expiresIn, 'Expires In', node, i);
	if (expiresIn !== undefined) body.expires_in = expiresIn;
	const metadata = parseJsonObject(options.metadata, 'Metadata', node, i);
	if (metadata) body.metadata = metadata;

	const submission = await create(
		this,
		{ method: 'POST', path: `/templates/${pathId(this, templateId, 'Template ID', i)}/submissions`, qs: versionQuery(this, i), body },
		'submission',
		i,
	);

	const linkType = stringParam(this, 'signingLinkType', i) || 'email';
	const created = Array.isArray(submission.signature_requests) ? (submission.signature_requests as IDataObject[]) : [];
	const withLinks: IDataObject[] = [];
	for (const signatureRequest of created) {
		let signingUrl: string | null = null;
		if (linkType !== 'none') {
			try {
				const token = (await request(
					this,
					{
						method: 'POST',
						path: `/signature_requests/${pathId(this, String(signatureRequest.id), 'Signature Request ID', i)}/tokens`,
						body: { type: linkType },
					},
					i,
				)) as IDataObject;
				signingUrl = (token.signature_request_url as string) ?? null;
			} catch (error) {
				throw new NodeOperationError(
					node,
					`DocSpring created submission ${submission.id}, but couldn't create a signing link for signature request ${signatureRequest.id}`,
					{
						itemIndex: i,
						description: `${errorText(error)}\nCreate the link with the Signature Request → Create Signing Link operation.`,
					},
				);
			}
		}
		withLinks.push({ ...signatureRequest, signing_url: signingUrl });
	}

	return {
		...submission,
		signature_requests: withLinks,
		first_signature_request_id: withLinks[0]?.id ?? null,
		first_signing_url: withLinks[0]?.signing_url ?? null,
	};
};

const createSigningLink: Operation = async function (i) {
	const id = requiredString(this, 'signatureRequestId', 'Signature Request ID', i);
	const type = stringParam(this, 'linkType', i) || 'email';
	return request(this, { method: 'POST', path: `/signature_requests/${pathId(this, id, 'Signature Request ID', i)}/tokens`, body: { type } }, i);
};

const getSignatureRequest: Operation = async function (i) {
	const id = requiredString(this, 'signatureRequestId', 'Signature Request ID', i);
	return request(this, { method: 'GET', path: `/signature_requests/${pathId(this, id, 'Signature Request ID', i)}` }, i);
};

// ─── Templates ────────────────────────────────────────────────────────────────

const getTemplate: Operation = async function (i) {
	const id = templateIdParam(this, i);
	return request(this, { method: 'GET', path: `/templates/${pathId(this, id, 'Template ID', i)}`, qs: versionQuery(this, i) }, i);
};

const getManyTemplates: Operation = async function (i) {
	const filters = optionsParam(this, i, 'filters');
	const qs: IDataObject = {};
	const query = filters.query === undefined ? '' : String(filters.query).trim();
	if (query) qs.query = query;
	const folderId = folderValue(filters.folderId);
	if (folderId) qs.parent_folder_id = folderId;
	return list(this, { method: 'GET', path: '/templates', qs }, i);
};

const createTemplate: Operation = async function (i) {
	const node = this.getNode();
	const options = optionsParam(this, i);
	const templateType = stringParam(this, 'templateType', i) || 'pdf';
	const body: IDataObject = { name: requiredString(this, 'name', 'Name', i), template_type: templateType };
	if (templateType === 'pdf') {
		Object.assign(body, await documentBody(this, i, options));
		if (toBoolean(this.getNodeParameter('detectFields', i, false), 'Detect Fields', node, i)) {
			body.detect_fields = true;
			const detection = optionsParam(this, i, 'fieldDetectionOptions');
			if (detection.fieldSource) body.field_source = detection.fieldSource;
			if (detection.fieldNaming) body.field_naming = detection.fieldNaming;
			if (detection.fieldLogic) body.field_logic = detection.fieldLogic;
		}
	} else {
		for (const [param, key] of [
			['html', 'html'],
			['scss', 'scss'],
			['headerHtml', 'header_html'],
			['footerHtml', 'footer_html'],
		]) {
			const value = this.getNodeParameter(param, i, '') as string;
			if (typeof value === 'string' && value.trim()) body[key] = value;
		}
	}
	const folderId = folderValue(options.folderId);
	if (folderId) body.parent_folder_id = folderId;
	return create(
		this,
		{ method: 'POST', path: '/templates', qs: waitQuery(this, options, i), body, sync: true },
		'template',
		i,
	);
};

const replaceTemplatePdf: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const options = optionsParam(this, i);
	const body = await documentBody(this, i, options);
	if (toBoolean(options.reimportFields, 'Reimport Fields', this.getNode(), i)) body.reimport_fields = true;
	return create(
		this,
		{
			method: 'PUT',
			path: `/templates/${pathId(this, id, 'Template ID', i)}/document`,
			qs: waitQuery(this, options, i),
			body,
			sync: true,
		},
		'template',
		i,
	);
};

const copyTemplate: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const options = optionsParam(this, i);
	const body: IDataObject = {};
	const name = options.name === undefined ? '' : String(options.name).trim();
	if (name) body.name = name;
	const folderId = folderValue(options.folderId);
	if (folderId !== undefined) body.parent_folder_id = folderId;
	const version = options.version === undefined ? '' : String(options.version).trim();
	if (version) body.version = version;
	return request(this, { method: 'POST', path: `/templates/${pathId(this, id, 'Template ID', i)}/copy`, body }, i);
};

const moveTemplate: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const folderId = folderValue(this.getNodeParameter('folderId', i, ''));
	if (folderId === undefined) {
		throw new NodeOperationError(this.getNode(), 'Choose a folder, or the root', { itemIndex: i });
	}
	return request(
		this,
		{ method: 'POST', path: `/templates/${pathId(this, id, 'Template ID', i)}/move`, body: { parent_folder_id: folderId } },
		i,
	);
};

const publishTemplateVersion: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const body: IDataObject = { version_type: stringParam(this, 'versionType', i) || 'patch' };
	const description = stringParam(this, 'versionDescription', i);
	if (description) body.description = description;
	return request(this, { method: 'POST', path: `/templates/${pathId(this, id, 'Template ID', i)}/publish_version`, body }, i);
};

const getTemplatePageImages: Operation = async function (i) {
	const id = templateIdParam(this, i);
	return request(this, { method: 'GET', path: `/templates/${pathId(this, id, 'Template ID', i)}/page_images`, qs: versionQuery(this, i) }, i);
};

// ─── Template fields ──────────────────────────────────────────────────────────

const getManyTemplateFields: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const response = (await request(
		this,
		{ method: 'GET', path: `/templates/${pathId(this, id, 'Template ID', i)}/fields`, qs: versionQuery(this, i) },
		i,
	)) as IDataObject;
	return Array.isArray(response.fields) ? (response.fields as IDataObject[]) : [];
};

const addTemplateFields: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const fields = parseJsonArrayOfObjects(this.getNodeParameter('fields', i), 'Fields', this.getNode(), i, 'fields');
	return request(this, { method: 'POST', path: `/templates/${pathId(this, id, 'Template ID', i)}/fields`, body: { fields } }, i);
};

const updateTemplateFields: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const fields = parseJsonArrayOfObjects(this.getNodeParameter('fields', i), 'Fields', this.getNode(), i, 'fields');
	return request(this, { method: 'PUT', path: `/templates/${pathId(this, id, 'Template ID', i)}/fields`, body: { fields } }, i);
};

const removeTemplateFields: Operation = async function (i) {
	const id = templateIdParam(this, i);
	const fieldIds = parseIntegerList(this.getNodeParameter('fieldIds', i, []), 'Field IDs', this.getNode(), i);
	if (fieldIds.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Choose at least one field to remove', { itemIndex: i });
	}
	return request(
		this,
		{ method: 'POST', path: `/templates/${pathId(this, id, 'Template ID', i)}/fields/remove`, body: { field_ids: fieldIds } },
		i,
	);
};

// ─── Folders ──────────────────────────────────────────────────────────────────

const getManyFolders: Operation = async function (i) {
	const filters = optionsParam(this, i, 'filters');
	const qs: IDataObject = {};
	const parent = folderValue(filters.parentFolderId);
	if (parent) qs.parent_folder_id = parent;
	return list(this, { method: 'GET', path: '/folders', qs }, i);
};

const createFolder: Operation = async function (i) {
	const options = optionsParam(this, i);
	const body: IDataObject = { name: requiredString(this, 'name', 'Name', i) };
	const parent = folderValue(options.parentFolderId);
	if (parent) body.parent_folder_id = parent;
	return request(this, { method: 'POST', path: '/folders', body }, i);
};

export const OPERATIONS: { [resourceAndOperation: string]: Operation } = {
	'submission:generatePdf': generatePdf,
	'submission:checkData': checkData,
	'submission:get': getSubmission,
	'submission:getMany': getManySubmissions,
	'submission:generateFiles': generateFiles,
	'submission:expire': expireSubmission,
	'submissionBatch:create': createSubmissionBatch,
	'submissionBatch:get': getSubmissionBatch,
	'combinedPdf:create': combinePdfs,
	'combinedPdf:get': getCombinedPdf,
	'signatureRequest:create': createSignatureRequest,
	'signatureRequest:createSigningLink': createSigningLink,
	'signatureRequest:get': getSignatureRequest,
	'template:create': createTemplate,
	'template:get': getTemplate,
	'template:getMany': getManyTemplates,
	'template:replacePdf': replaceTemplatePdf,
	'template:copy': copyTemplate,
	'template:move': moveTemplate,
	'template:publishVersion': publishTemplateVersion,
	'template:getPageImages': getTemplatePageImages,
	'templateField:getMany': getManyTemplateFields,
	'templateField:add': addTemplateFields,
	'templateField:update': updateTemplateFields,
	'templateField:remove': removeTemplateFields,
	'folder:getMany': getManyFolders,
	'folder:create': createFolder,
};
