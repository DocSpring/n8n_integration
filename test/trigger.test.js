'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createHookContext } = require('./helpers');
const { DocSpringTrigger, EVENTS } = require('../dist/nodes/DocSpring/DocSpringTrigger.node.js');
const { flattenDelivery } = require('../dist/nodes/DocSpring/GenericFunctions.js');

const hooks = new DocSpringTrigger().webhookMethods.default;
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';

describe('events', () => {
	test('lists every version 4 event except webhook.*', () => {
		assert.deepEqual(EVENTS.map((event) => event.value).sort(), [
			'combined_pdf.expired',
			'combined_pdf.failed',
			'combined_pdf.processed',
			'custom_file.created',
			'folder.created',
			'folder.deleted',
			'folder.updated',
			'signature_request.completed',
			'signature_request.declined',
			'signature_request.updated',
			'signature_request.viewed',
			'submission.created',
			'submission.declined',
			'submission.expired',
			'submission.failed',
			'submission.processed',
			'submission.updated',
			'submission_batch.failed',
			'submission_batch.processed',
			'template.created',
			'template.deleted',
			'template.updated',
		]);
	});
});

describe('webhook lifecycle', () => {
	test('create posts a flat API v2 webhook without a version and stores only its ID', async () => {
		const staticData = {};
		const { context, http } = createHookContext({
			params: {
				events: ['submission.processed', 'signature_request.completed'],
				mode: 'live',
				options: { templateIds: ['tpl_1', 'tpl_2'] },
			},
			staticData,
			responses: [{ statusCode: 201, body: { id: 'whk_1', version: 4, secret: 'shh', url: WEBHOOK_URL } }],
		});
		assert.equal(await hooks.create.call(context), true);
		const [request] = http.requests;
		assert.equal(request.method, 'POST');
		assert.equal(request.url, 'https://api.docspring.com/api/v2/webhooks');
		assert.deepEqual(request.body, {
			url: WEBHOOK_URL,
			event_types: ['submission.processed', 'signature_request.completed'],
			include_submission_data: true,
			name: 'n8n: Invoices',
			mode: 'live',
			template_ids: ['tpl_1', 'tpl_2'],
		});
		assert.deepEqual(staticData, { webhookId: 'whk_1' });
	});

	test('create leaves out the mode for live and test events, and can leave out submission data', async () => {
		const { context, http } = createHookContext({
			params: { events: ['template.created'], mode: 'all', options: { includeSubmissionData: 'false' } },
			responses: [{ statusCode: 201, body: { id: 'whk_2' } }],
		});
		await hooks.create.call(context);
		assert.deepEqual(http.requests[0].body, {
			url: WEBHOOK_URL,
			event_types: ['template.created'],
			include_submission_data: false,
			name: 'n8n: Invoices',
		});
	});

	test('checkExists is true for the stored webhook at this URL, and forgets a deleted one', async () => {
		const found = createHookContext({
			staticData: { webhookId: 'whk_1' },
			responses: [{ body: { id: 'whk_1', url: WEBHOOK_URL } }],
		});
		assert.equal(await hooks.checkExists.call(found.context), true);
		assert.equal(found.http.requests[0].url, 'https://api.docspring.com/api/v2/webhooks/whk_1');

		const otherUrl = createHookContext({
			staticData: { webhookId: 'whk_1' },
			responses: [{ body: { id: 'whk_1', url: 'https://n8n.example.com/webhook-test/abc/webhook' } }],
		});
		assert.equal(await hooks.checkExists.call(otherUrl.context), false);

		const gone = createHookContext({
			staticData: { webhookId: 'whk_1' },
			responses: [{ statusCode: 404, body: { error: { code: 'not_found', message: 'No webhook', details: [], request_id: 'r' } } }],
		});
		assert.equal(await hooks.checkExists.call(gone.context), false);
		assert.deepEqual(gone.staticData, {});
	});

	test('delete tolerates a 404 and surfaces other errors', async () => {
		const deleted = createHookContext({ staticData: { webhookId: 'whk_1' }, responses: [{ body: { id: 'whk_1' } }] });
		assert.equal(await hooks.delete.call(deleted.context), true);
		assert.equal(deleted.http.requests[0].method, 'DELETE');
		assert.equal(deleted.http.requests[0].url, 'https://api.docspring.com/api/v2/webhooks/whk_1');
		assert.deepEqual(deleted.staticData, {});

		const alreadyGone = createHookContext({
			staticData: { webhookId: 'whk_1' },
			responses: [{ statusCode: 404, body: { error: { code: 'not_found', message: 'No webhook', details: [], request_id: 'r' } } }],
		});
		assert.equal(await hooks.delete.call(alreadyGone.context), true);
		assert.deepEqual(alreadyGone.staticData, {});

		const failing = createHookContext({
			staticData: { webhookId: 'whk_1' },
			responses: [{ statusCode: 500, body: { error: { code: 'server_error', message: 'Oops', details: [], request_id: 'r' } } }],
		});
		await assert.rejects(hooks.delete.call(failing.context), /DocSpring API error 500 server_error: Oops/);
		assert.deepEqual(failing.staticData, { webhookId: 'whk_1' });
	});
});

describe('deliveries', () => {
	test('output the version 4 event with resource_type and resource_id', async () => {
		const delivery = {
			id: 'evt-uuid',
			event_type: 'signature_request.completed',
			created_at: '2026-06-27T03:16:07Z',
			data: { id: 'srq_1', submission_id: 'sub_1', created_at: '2026-06-01T00:00:00Z' },
		};
		const context = {
			getBodyData: () => delivery,
			helpers: { returnJsonArray: (data) => data.map((json) => ({ json })) },
		};
		const response = await new DocSpringTrigger().webhook.call(context);
		assert.deepEqual(response.workflowData, [
			[
				{
					json: {
						id: 'evt-uuid',
						event_type: 'signature_request.completed',
						created_at: '2026-06-27T03:16:07Z',
						resource_type: 'signature_request',
						resource_id: 'srq_1',
						data: delivery.data,
					},
				},
			],
		]);
	});

	test('flattenDelivery keeps unknown top-level keys and copes with a missing resource', () => {
		assert.deepEqual(flattenDelivery({ id: 'e', event_type: 'template.deleted', data: null, extra: 1 }), {
			id: 'e',
			event_type: 'template.deleted',
			created_at: undefined,
			resource_type: 'template',
			resource_id: null,
			data: null,
			extra: 1,
		});
	});
});

describe('IDs in paths', () => {
	test('a stored webhook ID of "." or ".." is never put in a path', async () => {
		const { context, http } = createHookContext({ staticData: { webhookId: '..' }, responses: [{ body: {} }] });
		await assert.rejects(hooks.delete.call(context), /Webhook ID can't be "\.\."/);
		assert.equal(http.requests.length, 0);
	});
});

describe('template filter', () => {
	test('fails before creating the webhook when template IDs are set with events that templates can\'t filter', async () => {
		const { context, http, staticData } = createHookContext({
			params: {
				events: ['submission.processed', 'combined_pdf.processed', 'folder.created', 'signature_request.completed'],
				mode: 'all',
				options: { templateIds: ['tpl_1'] },
			},
			responses: [{ statusCode: 201, body: { id: 'whk_1' } }],
		});
		await assert.rejects(hooks.create.call(context), (error) => {
			assert.equal(
				error.message,
				'Template IDs only filter submission, signature request and template events. Remove the template IDs, or remove these events: Combined PDF Processed, Folder Created',
			);
			return true;
		});
		assert.equal(http.requests.length, 0);
		assert.deepEqual(staticData, {});
	});

	test('allows template IDs with submission, signature request and template events, and any events without them', async () => {
		const scoped = createHookContext({
			params: {
				events: ['submission.created', 'signature_request.viewed', 'template.updated'],
				mode: 'all',
				options: { templateIds: 'tpl_1, tpl_2' },
			},
			responses: [{ statusCode: 201, body: { id: 'whk_1' } }],
		});
		assert.equal(await hooks.create.call(scoped.context), true);
		assert.deepEqual(scoped.http.requests[0].body.template_ids, ['tpl_1', 'tpl_2']);

		const unscoped = createHookContext({
			params: { events: ['combined_pdf.processed', 'folder.created'], mode: 'all', options: { templateIds: [] } },
			responses: [{ statusCode: 201, body: { id: 'whk_2' } }],
		});
		assert.equal(await hooks.create.call(unscoped.context), true);
		assert.equal('template_ids' in unscoped.http.requests[0].body, false);
	});

	test("the option's help says which events it filters", () => {
		const options = new DocSpringTrigger().description.properties.find((property) => property.name === 'options');
		const templateIds = options.options.find((option) => option.name === 'templateIds');
		assert.match(templateIds.description, /submission, signature request and template events/);
		assert.match(templateIds.description, /can't be filtered by template/);
	});
});
