import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

import { NO_API_V2_MESSAGE, USER_AGENT } from './version';

export type DocSpringContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export interface DocSpringCredentials {
	region?: string;
	customHost?: string;
	tokenId?: string;
	tokenSecret?: string;
}

// A request to DocSpring API v2. `path` is relative to /api/v2. `sync` sends it to the sync host, which can wait
// for PDFs (`wait` in `qs`).
export interface ApiRequest {
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	sync?: boolean;
}

export interface ErrorText {
	message: string;
	description?: string;
}

export const API_PATH_PREFIX = '/api/v2';

// Lists are paged with `limit` (1-100) and `cursor`. Pickers stop after this many items.
export const PAGE_SIZE = 100;
export const PICKER_MAX_ITEMS = 1000;

// The folder pickers' value for "the root" (folder IDs start with fld_, so it can't clash with one).
export const ROOT_FOLDER = 'root';

// A PDF sent as base64 can be up to 7 MB before it's encoded.
export const MAX_BASE64_DOCUMENT_BYTES = 7 * 1024 * 1024;

const HOSTS: { [region: string]: { standard: string; sync: string } } = {
	us: { standard: 'api.docspring.com', sync: 'sync.api.docspring.com' },
	eu: { standard: 'api-eu.docspring.com', sync: 'sync.api-eu.docspring.com' },
};

export function isSelfHosted(credentials: DocSpringCredentials): boolean {
	return (credentials.region || 'us').toLowerCase() === 'self_hosted';
}

// Region → origin. US and EU have a standard host and a sync host (for requests that wait for PDFs); a self-hosted
// install uses its one custom host for both.
export function resolveBaseUrl(credentials: DocSpringCredentials, sync: boolean, node: INode): string {
	const region = (credentials.region || 'us').toLowerCase();
	if (region === 'self_hosted') {
		const host = (credentials.customHost || '').trim().replace(/\/+$/, '');
		if (!host) {
			throw new NodeOperationError(
				node,
				'Enter your DocSpring URL (such as https://docspring.example.com) as the Self-Hosted Host in the DocSpring credential.',
			);
		}
		return host.includes('://') ? host : `https://${host}`;
	}
	const entry = HOSTS[region];
	if (!entry) {
		throw new NodeOperationError(node, `Unknown DocSpring region "${credentials.region}" in the credential`);
	}
	return `https://${sync ? entry.sync : entry.standard}`;
}

// An ID for a URL path. encodeURIComponent leaves "." and ".." as they are, and the URL would resolve them to
// another path (a submission ID of ".." would make Expire Submission call DELETE /api/v2/), so they're rejected.
export function encodeId(id: string, label: string, node: INode, itemIndex?: number): string {
	const trimmed = String(id).trim();
	if (trimmed === '.' || trimmed === '..') {
		throw new NodeOperationError(node, `${label} can't be "${trimmed}"`, { itemIndex });
	}
	return encodeURIComponent(id);
}

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ERROR_RECORD_LABELS: Array<[string, string]> = [
	['submission_id', 'Submission'],
	['submission_batch_id', 'Submission batch'],
	['combined_pdf_id', 'Combined PDF'],
	['template_id', 'Template'],
];

const POLLING_TIMEOUT_MESSAGES: Array<[string, (id: string) => string]> = [
	[
		'submission_id',
		(id) =>
			`The PDF wasn't ready in time. Get it later with Get Submission (${id}), or use the submission.processed trigger.`,
	],
	[
		'submission_batch_id',
		(id) =>
			`The PDFs weren't ready in time. Get them later with Get Submission Batch (${id}), or use the submission_batch.processed trigger.`,
	],
	[
		'combined_pdf_id',
		(id) =>
			`The combined PDF wasn't ready in time. Get it later with Get Combined PDF (${id}), or use the combined_pdf.processed trigger.`,
	],
	[
		'template_id',
		(id) => `The template's PDF wasn't processed in time. Get the template later with Get Template (${id}).`,
	],
];

// Turns an API v2 error response into the text the node shows:
//   DocSpring API error <status> <code>: <message>
//   <pointer or parameter>: <detail message>   (one line per detail)
//   Submission: <submission_id>                (or the other record IDs)
//   Request ID: <request_id>
// The first line is the message; the rest is the description.
export function formatApiError(status: number, body: unknown, selfHosted: boolean): ErrorText {
	const error = isObject(body) && isObject(body.error) ? body.error : undefined;
	if (!error) {
		if (status === 404 && selfHosted) return { message: NO_API_V2_MESSAGE };
		const text = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
		return { message: `DocSpring API error ${status}${text ? `: ${text}` : ''}` };
	}

	const code = typeof error.code === 'string' ? error.code : 'unknown_error';
	const message = typeof error.message === 'string' ? error.message : 'No error message';
	const requestId = typeof error.request_id === 'string' ? error.request_id : undefined;

	if (code === 'polling_timeout') {
		for (const [key, text] of POLLING_TIMEOUT_MESSAGES) {
			if (typeof error[key] === 'string' && error[key]) {
				return {
					message: text(error[key] as string),
					description: requestId ? `Request ID: ${requestId}` : undefined,
				};
			}
		}
	}

	const lines: string[] = [];
	const details = Array.isArray(error.details) ? error.details : [];
	for (const detail of details) {
		if (!isObject(detail)) continue;
		const where =
			typeof detail.pointer === 'string' && detail.pointer !== ''
				? detail.pointer
				: typeof detail.parameter === 'string'
					? detail.parameter
					: '';
		const detailMessage = typeof detail.message === 'string' ? detail.message : String(detail.code ?? '');
		const submission = typeof detail.submission_id === 'string' ? ` (Submission: ${detail.submission_id})` : '';
		lines.push(`${where ? `${where}: ` : ''}${detailMessage}${submission}`);
	}
	for (const [key, label] of ERROR_RECORD_LABELS) {
		if (typeof error[key] === 'string' && error[key]) lines.push(`${label}: ${error[key]}`);
	}
	if (requestId) lines.push(`Request ID: ${requestId}`);

	return {
		message: `DocSpring API error ${status} ${code}: ${message}`,
		description: lines.length ? lines.join('\n') : undefined,
	};
}

// The whole error text, for continueOnFail output and for wrapping one error in another.
export function errorText(error: unknown): string {
	const err = error as { message?: string; description?: string | null };
	const message = err?.message ?? String(error);
	return err?.description ? `${message}\n${err.description}` : message;
}

// A 429 means DocSpring didn't process the request (test API tokens make 5 requests a minute, with bursts of 15),
// so it's sent again after Retry-After, up to `maxRetries` times while each wait is `maxWaitSeconds` or less. Tests
// replace `wait`.
export const rateLimitRetry = {
	maxRetries: 3,
	maxWaitSeconds: 60,
	wait: async (seconds: number): Promise<void> => await sleep(seconds * 1000),
};

// Retry-After in whole seconds, rounded up: at least 1, and 1 when it's missing or isn't a number.
export function retryAfterSeconds(headers: unknown): number {
	let value: unknown;
	if (isObject(headers)) {
		const key = Object.keys(headers).find((name) => name.toLowerCase() === 'retry-after');
		value = key === undefined ? undefined : headers[key];
	}
	if (Array.isArray(value)) value = value[0];
	const text = value === undefined || value === null ? '' : String(value).trim();
	const seconds = Number(text);
	if (!text || !Number.isFinite(seconds)) return 1;
	return Math.max(1, Math.ceil(seconds));
}

// Calls DocSpring API v2 with the credential's Basic auth, retrying a 429 (see rateLimitRetry). HTTP errors become
// a NodeApiError with DocSpring's error message, details and request ID.
export async function docSpringApiRequest(
	this: DocSpringContext,
	request: ApiRequest,
	itemIndex?: number,
): Promise<any> {
	const node = this.getNode();
	const credentials = (await this.getCredentials('docSpringApi')) as DocSpringCredentials;
	const baseUrl = resolveBaseUrl(credentials, request.sync === true, node);

	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${baseUrl}${API_PATH_PREFIX}${request.path}`,
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.qs && Object.keys(request.qs).length) options.qs = request.qs;
	if (request.body !== undefined) options.body = request.body;

	let response: IN8nHttpFullResponse;
	for (let retries = 0; ; retries++) {
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(this, 'docSpringApi', {
				...options,
				headers: { ...options.headers },
			})) as IN8nHttpFullResponse;
		} catch (error) {
			if (error instanceof NodeApiError || error instanceof NodeOperationError) throw error;
			throw new NodeApiError(node, error as JsonObject, { itemIndex });
		}
		if (Number(response?.statusCode) !== 429 || retries >= rateLimitRetry.maxRetries) break;
		const seconds = retryAfterSeconds(response.headers);
		if (seconds > rateLimitRetry.maxWaitSeconds) break;
		await rateLimitRetry.wait(seconds);
	}

	const status = Number(response?.statusCode);
	if (status >= 400) {
		const text = formatApiError(status, response.body, isSelfHosted(credentials));
		const errorBody = isObject(response.body) ? (response.body as JsonObject) : { body: String(response.body) };
		throw new NodeApiError(node, errorBody, {
			message: text.message,
			description: text.description,
			httpCode: String(status),
			itemIndex,
		});
	}
	return response.body;
}

// Follows `next_cursor` until `max` items (or every item) have been fetched.
export async function docSpringApiRequestAllItems(
	this: DocSpringContext,
	request: ApiRequest,
	max: number,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const remaining = max - results.length;
		const qs: IDataObject = { ...(request.qs || {}), limit: Math.max(1, Math.min(PAGE_SIZE, remaining)) };
		if (cursor) qs.cursor = cursor;
		const page = await docSpringApiRequest.call(this, { ...request, qs }, itemIndex);
		const data = isObject(page) && Array.isArray(page.data) ? (page.data as IDataObject[]) : [];
		results.push(...data);
		cursor = isObject(page) && typeof page.next_cursor === 'string' && page.next_cursor ? page.next_cursor : undefined;
		if (data.length === 0) break;
	} while (cursor && results.length < max);
	return results.slice(0, max);
}

// ─── Failed records (a 201 whose state is a failure) ──────────────────────────

const SUBMISSION_FAILURE_STATES = ['error', 'syntax_error', 'image_download_failed', 'image_processing_failed'];
const TEMPLATE_DOCUMENT_FAILURE_STATES = ['password_required', 'malformed_pdf', 'unknown_error', 'download_failed'];

export type RecordKind = 'submission' | 'submissionBatch' | 'combinedPdf' | 'template';

// Returns the error to show when a created record came back in a failure state.
export function recordFailure(kind: RecordKind, record: unknown): ErrorText | undefined {
	if (!isObject(record)) return undefined;
	const id = String(record.id ?? '');
	const errorMessage = (value: unknown) => (typeof value === 'string' && value ? value : 'No error message');

	if (kind === 'submission' && SUBMISSION_FAILURE_STATES.includes(record.state as string)) {
		return {
			message: `DocSpring couldn't generate the PDF (state: ${record.state}): ${errorMessage(record.error_message)}`,
			description: `Submission: ${id}`,
		};
	}
	if (kind === 'combinedPdf' && record.state === 'error') {
		return {
			message: `DocSpring couldn't combine the PDFs (state: error): ${errorMessage(record.error_message)}`,
			description: `Combined PDF: ${id}`,
		};
	}
	if (kind === 'submissionBatch' && record.state === 'error') {
		const submissions = Array.isArray(record.submissions) ? (record.submissions as IDataObject[]) : [];
		const failed = submissions.filter((s) => isObject(s) && SUBMISSION_FAILURE_STATES.includes(s.state as string));
		const lines = failed.map((s) => `${s.id} (state: ${s.state}): ${errorMessage(s.error_message)}`);
		lines.push(`Submission batch: ${id}`);
		return {
			message: `DocSpring couldn't generate ${failed.length || 'some'} of the ${submissions.length || record.total_count} PDFs in the batch (state: error)`,
			description: lines.join('\n'),
		};
	}
	if (kind === 'template' && isObject(record.document)) {
		const document = record.document;
		if (TEMPLATE_DOCUMENT_FAILURE_STATES.includes(document.state as string)) {
			return {
				message: `DocSpring couldn't process the template's PDF (state: ${document.state}): ${errorMessage(document.error_message)}`,
				description: `Template: ${id}`,
			};
		}
	}
	return undefined;
}

// Returns the error to show when Generate Files couldn't make one of the formats.
export function generatedFilesFailure(submission: unknown, formats: string[]): ErrorText | undefined {
	if (!isObject(submission) || !isObject(submission.files)) return undefined;
	for (const format of formats) {
		const file = submission.files[format];
		if (isObject(file) && file.state === 'error') {
			const message = typeof file.error_message === 'string' && file.error_message ? file.error_message : 'No error message';
			return {
				message: `DocSpring couldn't make the ${format} files (state: error): ${message}`,
				description: `Submission: ${submission.id}`,
			};
		}
	}
	return undefined;
}

// ─── Input conversion ─────────────────────────────────────────────────────────
// n8n hands over expression results as they are, so a boolean or a number can arrive as a string.

export function toBoolean(value: unknown, label: string, node: INode, itemIndex: number): boolean {
	if (typeof value === 'boolean') return value;
	if (value === undefined || value === null || value === '') return false;
	if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
	if (typeof value === 'string') {
		const text = value.trim().toLowerCase();
		if (text === 'true') return true;
		if (text === 'false') return false;
	}
	throw new NodeOperationError(node, `${label} must be true or false, not ${JSON.stringify(value)}`, { itemIndex });
}

export function toInteger(value: unknown, label: string, node: INode, itemIndex: number): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const number = typeof value === 'number' ? value : Number(String(value).trim());
	if (!Number.isInteger(number)) {
		throw new NodeOperationError(node, `${label} must be a whole number, not ${JSON.stringify(value)}`, {
			itemIndex,
		});
	}
	return number;
}

function parseJsonValue(value: unknown, label: string, node: INode, itemIndex: number): unknown {
	if (typeof value !== 'string') return value;
	const text = value.trim();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new NodeOperationError(node, `${label} isn't valid JSON: ${(error as Error).message}`, { itemIndex });
	}
}

// A JSON object parameter (n8n's json type is a string unless it comes from an expression). Empty objects are
// left out.
export function parseJsonObject(
	value: unknown,
	label: string,
	node: INode,
	itemIndex: number,
): IDataObject | undefined {
	const parsed = parseJsonValue(value, label, node, itemIndex);
	if (parsed === undefined || parsed === null) return undefined;
	if (!isObject(parsed)) {
		throw new NodeOperationError(node, `${label} must be a JSON object`, { itemIndex });
	}
	return Object.keys(parsed).length ? parsed : undefined;
}

// A JSON array of objects. `wrapperKey` also accepts an object that holds the array under that key.
export function parseJsonArrayOfObjects(
	value: unknown,
	label: string,
	node: INode,
	itemIndex: number,
	wrapperKey?: string,
): IDataObject[] {
	let parsed = parseJsonValue(value, label, node, itemIndex);
	if (wrapperKey && isObject(parsed) && Array.isArray(parsed[wrapperKey])) parsed = parsed[wrapperKey];
	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => isObject(entry))) {
		throw new NodeOperationError(node, `${label} must be a JSON array with at least one object`, { itemIndex });
	}
	return parsed as IDataObject[];
}

// A list from a multi-select, a JSON array, or text separated by commas or new lines.
export function parseList(value: unknown): string[] {
	if (value === undefined || value === null || value === '') return [];
	let list: unknown[];
	if (Array.isArray(value)) {
		list = value;
	} else {
		const text = String(value).trim();
		if (text.startsWith('[')) {
			try {
				const parsed = JSON.parse(text);
				list = Array.isArray(parsed) ? parsed : [text];
			} catch {
				list = text.split(/[\n,]/);
			}
		} else {
			list = text.split(/[\n,]/);
		}
	}
	return list.map((entry) => String(entry).trim()).filter(Boolean);
}

export function parseIntegerList(value: unknown, label: string, node: INode, itemIndex: number): number[] {
	return parseList(value).map((entry) => {
		const number = Number(entry);
		if (!Number.isInteger(number)) {
			throw new NodeOperationError(node, `${label} must be whole numbers, not ${JSON.stringify(entry)}`, {
				itemIndex,
			});
		}
		return number;
	});
}

// Leaves out the values a user left empty (undefined, null and ""), so optional values aren't sent.
export function withoutEmptyValues(data: IDataObject | null | undefined): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(data || {})) {
		if (value === undefined || value === null || value === '') continue;
		result[key] = value;
	}
	return result;
}

// Offset of `timeZone` from UTC at the given instant, in minutes.
function timeZoneOffsetMinutes(utcMillis: number, timeZone: string): number {
	const parts: { [type: string]: string } = {};
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	for (const part of formatter.formatToParts(new Date(utcMillis))) parts[part.type] = part.value;
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	return Math.round((asUtc - Math.floor(utcMillis / 1000) * 1000) / 60000);
}

// API v2 date filters take RFC 3339 times with an offset. n8n's date picker gives a local time without one
// (2025-01-31T09:00:00), which is read in the workflow's time zone.
export function toRfc3339(
	value: unknown,
	timeZone: string,
	label: string,
	node: INode,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object' && typeof (value as { toISO?: unknown }).toISO === 'function') {
		return (value as { toISO: () => string }).toISO();
	}
	const text = String(value).trim();
	if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text) && !Number.isNaN(Date.parse(text))) return text;

	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(text);
	if (!match) {
		throw new NodeOperationError(node, `${label} must be a date and time such as 2025-01-31T09:00:00Z`, {
			itemIndex,
		});
	}
	const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
	const wallClock = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
	const zone = timeZone || 'UTC';
	const firstGuess = wallClock - timeZoneOffsetMinutes(wallClock, zone) * 60000;
	const utc = wallClock - timeZoneOffsetMinutes(firstGuess, zone) * 60000;
	return new Date(utc).toISOString().replace('.000Z', 'Z');
}

// ─── Template schema → n8n fields ─────────────────────────────────────────────

function schemaType(prop: IDataObject): string | undefined {
	return Array.isArray(prop.type)
		? (prop.type as string[]).find((type) => type !== 'null')
		: (prop.type as string | undefined);
}

// Turns a template's JSON Schema (GET /templates/{id}/schema) into resource mapper fields. `allOptional` makes
// every field optional (Create Signature Request and Check Data). Date fields are text inputs that say the format
// API v2 takes; checkbox fields are a Leave Blank / True / False choice; nested objects and lists are JSON inputs.
export function schemaToResourceMapperFields(schema: unknown, allOptional = false): IDataObject[] {
	const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
	const required = new Set(isObject(schema) && Array.isArray(schema.required) ? (schema.required as string[]) : []);

	return Object.keys(properties).map((name) => {
		const prop = isObject(properties[name]) ? (properties[name] as IDataObject) : {};
		const type = schemaType(prop);
		const field: IDataObject = {
			id: name,
			displayName: name,
			required: allOptional ? false : required.has(name),
			defaultMatch: false,
			display: true,
			type: 'string',
		};
		if (Array.isArray(prop.enum)) {
			field.type = 'options';
			field.options = (prop.enum as unknown[])
				.filter((value) => value !== null)
				.map((value) => ({ name: String(value), value }));
		} else if (type === 'integer' || type === 'number') {
			field.type = 'number';
		} else if (type === 'boolean') {
			// A checkbox. n8n's resource mapper gives a boolean field a default of false, and API v2 treats false as a
			// prefilled value (a signer's field with one is a 422), so it's a choice that starts blank. An options field
			// gets no default (null), and blank ("") is left out of the data.
			field.type = 'options';
			field.options = [
				{ name: 'Leave Blank', value: '', description: "Don't send a value for this field" },
				{ name: 'True', value: true },
				{ name: 'False', value: false },
			];
			field.defaultValue = null;
		} else if (type === 'object') {
			field.type = 'object';
		} else if (type === 'array') {
			field.type = 'array';
		} else if (type === 'string' && prop.format === 'date-time') {
			field.type = 'dateTime';
		} else if (type === 'string' && prop.format === 'date') {
			field.displayName = `${name} (YYYY-MM-DD)`;
		}
		return field;
	});
}

// The names a signer can be given to fill in, from a template's fields (GET /templates/{id}/fields): each name once,
// in the API's order, without static fields, combined fields or @@ submission details, which take no value.
export function signerFieldNames(fields: unknown): string[] {
	const names: string[] = [];
	for (const field of Array.isArray(fields) ? fields : []) {
		if (!isObject(field)) continue;
		const name = field.name;
		if (typeof name !== 'string' || !name) continue;
		if (field.static === true || field.type === 'combined' || name.startsWith('@@')) continue;
		if (!names.includes(name)) names.push(name);
	}
	return names;
}

export function folderPath(folder: IDataObject): string {
	const parent = typeof folder.path === 'string' && folder.path !== '/' ? folder.path : '';
	return `${parent}/${folder.name ?? folder.id}`;
}

// ─── Webhook events ───────────────────────────────────────────────────────────

// A version 4 webhook delivery as received, plus `resource_type` (the event name before the first dot) and
// `resource_id` (the resource's ID). `id` stays the event ID, which is the same when a delivery is retried.
export function flattenDelivery(body: unknown): IDataObject {
	const event = isObject(body) ? body : {};
	const { id, event_type: eventType, created_at: createdAt, data, ...rest } = event;
	const resourceType = typeof eventType === 'string' && eventType.includes('.') ? eventType.split('.')[0] : null;
	const resourceId = isObject(data) && data.id !== undefined ? data.id : null;
	return {
		id,
		event_type: eventType,
		created_at: createdAt,
		resource_type: resourceType,
		resource_id: resourceId,
		data,
		...rest,
	};
}

// The request body exactly as received, which the signature covers. n8n reads it into `rawBody` (a Buffer) before it
// parses the JSON; `readRawBody()` reads it when that hasn't happened yet. Undefined when neither is there.
export async function rawRequestBody(request: unknown): Promise<Buffer | string | undefined> {
	const req = (request || {}) as { rawBody?: unknown; readRawBody?: () => Promise<void> };
	if (req.rawBody === undefined && typeof req.readRawBody === 'function') await req.readRawBody();
	const raw = req.rawBody;
	return Buffer.isBuffer(raw) || typeof raw === 'string' ? raw : undefined;
}

// Checks an X-DocSpring-Signature header (`t=<unix time>,v1=<hex>`): v1 is the HMAC-SHA256, in hex, of
// "<t>.<raw body>" with the webhook's secret. The header can hold several v1 values (while a secret is being
// replaced), and any of them can match. Each is compared in constant time. The timestamp's age isn't checked.
export function verifyWebhookSignature(secret: string, header: unknown, rawBody: Buffer | string): boolean {
	const text = Array.isArray(header) ? header.join(',') : typeof header === 'string' ? header : '';
	let timestamp: string | undefined;
	const signatures: string[] = [];
	for (const part of text.split(',')) {
		const separator = part.indexOf('=');
		if (separator < 0) continue;
		const key = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (key === 't' && timestamp === undefined) timestamp = value;
		if (key === 'v1' && value) signatures.push(value);
	}
	if (!timestamp || signatures.length === 0) return false;

	const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'));
	return signatures.some((signature) => {
		const given = Buffer.from(signature);
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}
