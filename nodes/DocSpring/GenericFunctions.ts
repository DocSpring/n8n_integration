import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

interface DocSpringCredentials {
	region: string;
	customHost?: string;
	tokenId: string;
	tokenSecret: string;
}

// Region → API host. `sync` selects the low-latency host used for synchronous
// PDF generation (Generate PDF / Combine PDFs with ?wait=true). Self-hosted
// installs use a single custom origin for both.
export function resolveBaseUrl(credentials: DocSpringCredentials, sync = false): string {
	const region = (credentials.region || 'us').toLowerCase();

	if (region === 'self_hosted') {
		const host = (credentials.customHost || '').trim();
		if (!host) {
			throw new Error(
				'A Self-Hosted Host is required for the Self-Hosted / Enterprise region. Enter your DocSpring URL (e.g. https://docspring.example.com) in the credential.',
			);
		}
		return host.includes('://') ? host : `https://${host}`;
	}

	const hosts: { [key: string]: { host: string; sync: string } } = {
		us: { host: 'api.docspring.com', sync: 'sync.api.docspring.com' },
		eu: { host: 'api-eu.docspring.com', sync: 'sync.api-eu.docspring.com' },
	};
	const entry = hosts[region] ?? hosts.us;
	return `https://${sync ? entry.sync : entry.host}`;
}

// Authenticated DocSpring API request. Applies the credential's Basic auth and
// surfaces DocSpring's `{ status: 'error', errors: [...] }` payloads as a clean
// error message.
export async function docSpringApiRequest(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject = {},
	qs: IDataObject = {},
	options: { sync?: boolean } = {},
): Promise<any> {
	const credentials = (await this.getCredentials('docSpringApi')) as unknown as DocSpringCredentials;
	const baseUrl = resolveBaseUrl(credentials, options.sync);

	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${baseUrl}/api/v1${resource}`,
		qs,
		body,
		json: true,
	};
	if (Object.keys(body).length === 0) {
		delete requestOptions.body;
	}
	if (Object.keys(qs).length === 0) {
		delete requestOptions.qs;
	}

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'docSpringApi',
			requestOptions,
		);
		// Some endpoints return HTTP 200 with a { status: 'error' } body.
		if (response && typeof response === 'object' && response.status === 'error') {
			const errors = (response.errors as string[] | undefined)?.join(', ') || 'Unknown DocSpring error';
			throw new NodeOperationError(this.getNode(), errors);
		}
		return response;
	} catch (error) {
		const err = error as any;
		const errorBody = err?.response?.body ?? err?.cause?.response?.body ?? err?.error;
		const errors = errorBody?.errors as string[] | undefined;
		if (errors?.length) {
			throw new NodeApiError(this.getNode(), err as JsonObject, { message: errors.join(', ') });
		}
		if (err instanceof NodeOperationError) throw err;
		throw new NodeApiError(this.getNode(), err as JsonObject);
	}
}

// Map a JSON-Schema (draft-04) property to an n8n resource-mapper field type.
function schemaFieldType(prop: IDataObject): string {
	const rawType = Array.isArray(prop.type)
		? (prop.type as string[]).find((t) => t !== 'null')
		: (prop.type as string | undefined);
	switch (rawType) {
		case 'integer':
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'string':
			if (prop.format === 'date-time' || prop.format === 'date') return 'dateTime';
			return 'string';
		default:
			return 'string';
	}
}

// Turn a template's field schema (GET /templates/{id}/schema) into resource-mapper
// columns. `allOptional` forces every field non-required (Create Data Request:
// recipients fill in whatever the sender leaves blank).
export function schemaToResourceMapperFields(
	schema: IDataObject,
	allOptional = false,
): Array<IDataObject> {
	const props = (schema?.properties as IDataObject) || {};
	const required = new Set((schema?.required as string[]) || []);

	return Object.keys(props).map((name) => {
		const prop = (props[name] as IDataObject) || {};
		const field: IDataObject = {
			id: name,
			displayName: name,
			required: allOptional ? false : required.has(name),
			defaultMatch: false,
			display: true,
			type: schemaFieldType(prop),
		};
		if (Array.isArray(prop.enum)) {
			field.type = 'options';
			field.options = (prop.enum as unknown[]).map((v) => ({ name: String(v), value: v }));
		}
		return field;
	});
}

// Flatten a v3 webhook delivery into a single object. The top-level `id` is the
// event UUID (stable across retries); the resource's own id is exposed as
// `resource_id`. Mirrors the Zapier/Make integrations.
export function flattenDelivery(body: IDataObject): IDataObject {
	const safe = body || {};
	const data = (safe.data as IDataObject) || {};
	const resource = (data.resource as IDataObject) || {};

	const { id: resourceId, resource: _resourceRef, ...rest } = data;

	return {
		id: safe.id,
		event: safe.event,
		timestamp: safe.timestamp,
		resource_type: resource.type,
		resource_id: resourceId != null ? resourceId : resource.id,
		...rest,
	};
}
