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
