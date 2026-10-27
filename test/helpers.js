// Mock n8n contexts for running the compiled node against fake HTTP responses. No request leaves the process:
// every DocSpring call goes through helpers.httpRequestWithAuthentication, which records it and returns the next
// queued response, and Node's http/https/fetch throw if anything tries to use the network.
'use strict';

const http = require('node:http');
const https = require('node:https');

function blockNetwork() {
	const blocked = () => {
		throw new Error('Tests must not make network requests');
	};
	http.request = blocked;
	http.get = blocked;
	https.request = blocked;
	https.get = blocked;
	globalThis.fetch = blocked;
}
blockNetwork();

const NODE = { id: 'node-1', name: 'DocSpring', type: 'docSpring', typeVersion: 1, position: [0, 0], parameters: {} };

function getPath(object, path) {
	return path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);
}

function lookupParameter(params, name, itemIndex, fallback, options, hasFallback) {
	const source = typeof params === 'function' ? params(itemIndex) : params;
	let value = getPath(source, name);
	if (value === undefined) {
		if (hasFallback) return fallback;
		throw new Error(`Test didn't set the parameter "${name}"`);
	}
	if (options && options.extractValue && value && typeof value === 'object' && 'value' in value) {
		value = value.value;
	}
	return value;
}

// A fake HTTP layer. `responses` are returned in order: { statusCode, body }.
function createHttp(responses = []) {
	const queue = [...responses];
	const requests = [];
	async function httpRequestWithAuthentication(credentialType, options) {
		requests.push({ credentialType, ...options });
		if (queue.length === 0) throw new Error(`No mocked response for ${options.method} ${options.url}`);
		const next = queue.shift();
		if (next instanceof Error) throw next;
		return { statusCode: next.statusCode ?? 200, headers: {}, body: next.body };
	}
	return { requests, httpRequestWithAuthentication, remaining: () => queue.length };
}

const DEFAULT_CREDENTIALS = { region: 'us', tokenId: 'api_test', tokenSecret: 'secret' };

function createExecuteContext({
	params,
	items = [{ json: {} }],
	responses = [],
	credentials = DEFAULT_CREDENTIALS,
	binary = {},
	continueOnFail = false,
	timezone = 'UTC',
}) {
	const httpMock = createHttp(responses);
	const context = {
		getInputData: () => items,
		getNode: () => NODE,
		getTimezone: () => timezone,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => credentials,
		getNodeParameter(name, itemIndex, fallback, options) {
			return lookupParameter(params, name, itemIndex, fallback, options, arguments.length >= 3);
		},
		helpers: {
			httpRequestWithAuthentication: httpMock.httpRequestWithAuthentication,
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (executionItems, { itemData }) =>
				executionItems.map((item) => ({ ...item, pairedItem: itemData })),
			assertBinaryData(itemIndex, propertyName) {
				if (!binary[propertyName]) throw new Error(`No binary data in "${propertyName}"`);
				return binary[propertyName];
			},
			async getBinaryDataBuffer(itemIndex, propertyName) {
				return Buffer.from(binary[propertyName].data, 'base64');
			},
		},
	};
	return { context, http: httpMock };
}

function createLoadOptionsContext({ params = {}, responses = [], credentials = DEFAULT_CREDENTIALS }) {
	const httpMock = createHttp(responses);
	const context = {
		getNode: () => NODE,
		getCredentials: async () => credentials,
		getNodeParameter(name, fallback, options) {
			return lookupParameter(params, name, 0, fallback, options, arguments.length >= 2);
		},
		getCurrentNodeParameter(name, options) {
			return lookupParameter(params, name, 0, undefined, options, true);
		},
		helpers: { httpRequestWithAuthentication: httpMock.httpRequestWithAuthentication },
	};
	return { context, http: httpMock };
}

function createHookContext({
	params = {},
	responses = [],
	staticData = {},
	webhookUrl = 'https://n8n.example.com/webhook/abc/webhook',
	workflowName = 'Invoices',
	credentials = DEFAULT_CREDENTIALS,
}) {
	const httpMock = createHttp(responses);
	const context = {
		getNode: () => ({ ...NODE, name: 'DocSpring Trigger', type: 'docSpringTrigger' }),
		getCredentials: async () => credentials,
		getWorkflow: () => ({ id: 'wf-1', name: workflowName, active: true }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter(name, fallback, options) {
			return lookupParameter(params, name, 0, fallback, options, arguments.length >= 2);
		},
		helpers: { httpRequestWithAuthentication: httpMock.httpRequestWithAuthentication },
	};
	return { context, http: httpMock, staticData };
}

// A webhook delivery as n8n hands it to the trigger: the parsed body, the headers (lower case, as Node gives them)
// and the request object, whose rawBody holds the bytes received. With `readLater`, rawBody is only set when the
// node calls readRawBody(). The response records a status and body sent by the node.
function createWebhookContext({ body, rawBody, headers = {}, staticData = {}, readLater = false }) {
	const request = { headers };
	if (readLater) {
		request.readRawBody = async () => {
			request.rawBody = rawBody;
		};
	} else if (rawBody !== undefined) {
		request.rawBody = rawBody;
	}
	const response = {
		statusCode: undefined,
		body: undefined,
		status(code) {
			this.statusCode = code;
			return this;
		},
		send(text) {
			this.body = text;
			return this;
		},
		end() {
			return this;
		},
	};
	const context = {
		getNode: () => ({ ...NODE, name: 'DocSpring Trigger', type: 'docSpringTrigger' }),
		getWorkflowStaticData: () => staticData,
		getBodyData: () => body,
		getHeaderData: () => headers,
		getRequestObject: () => request,
		getResponseObject: () => response,
		helpers: { returnJsonArray: (data) => data.map((json) => ({ json })) },
	};
	return { context, response };
}

module.exports = { createExecuteContext, createLoadOptionsContext, createHookContext, createWebhookContext, NODE };
