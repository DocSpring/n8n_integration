'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createExecuteContext } = require('./helpers');
const { DocSpring } = require('../dist/nodes/DocSpring/DocSpring.node.js');
const { OPERATIONS } = require('../dist/nodes/DocSpring/operations.js');
const { USER_AGENT } = require('../dist/nodes/DocSpring/version.js');

const TEMPLATE = { __rl: true, mode: 'list', value: 'tpl_123' };

async function run(options) {
	const { context, http } = createExecuteContext(options);
	const output = await new DocSpring().execute.call(context);
	return { output: output[0].map((item) => item.json), requests: http.requests, http };
}

function submission(overrides = {}) {
	return {
		id: 'sub_1',
		state: 'processed',
		files: { pdf: { state: 'processed', download_url: 'https://downloads.docspring.com/sub_1.pdf' } },
		signature_requests: [],
		...overrides,
	};
}

describe('node description', () => {
	test('every operation in the UI has a handler, and every handler is in the UI', () => {
		const { properties } = new DocSpring().description;
		const fromUi = [];
		for (const property of properties) {
			if (property.name !== 'operation') continue;
			for (const option of property.options) fromUi.push(`${property.displayOptions.show.resource[0]}:${option.value}`);
		}
		assert.deepEqual(fromUi.sort(), Object.keys(OPERATIONS).sort());
	});

	test('has the resources and operations of the spec', () => {
		assert.deepEqual(Object.keys(OPERATIONS).sort(), [
			'combinedPdf:create',
			'combinedPdf:get',
			'folder:create',
			'folder:getMany',
			'signatureRequest:create',
			'signatureRequest:createSigningLink',
			'signatureRequest:get',
			'submission:checkData',
			'submission:expire',
			'submission:generateFiles',
			'submission:generatePdf',
			'submission:get',
			'submission:getMany',
			'submissionBatch:create',
			'submissionBatch:get',
			'template:copy',
			'template:create',
			'template:get',
			'template:getMany',
			'template:getPageImages',
			'template:move',
			'template:publishVersion',
			'template:replacePdf',
			'templateField:add',
			'templateField:getMany',
			'templateField:remove',
			'templateField:update',
		]);
	});

	test('the subtitle shows the operation label, not its value', () => {
		const { subtitle, version } = new DocSpring().description;
		assert.equal(version, 1);
		assert.match(subtitle, /"submission:generatePdf":"Generate a PDF"/);
		assert.match(subtitle, /"signatureRequest:create":"Create a signature request"/);
		assert.doesNotMatch(subtitle, /dataRequest|combinedSubmission/);
	});
});

describe('Submission: Generate PDF', () => {
	const params = (overrides = {}) => ({
		resource: 'submission',
		operation: 'generatePdf',
		templateId: TEMPLATE,
		templateVersion: '1.2.0',
		templateData: { mappingMode: 'defineBelow', value: { first_name: 'Jane', last_name: '', notes: null, age: 41 } },
		test: false,
		options: {},
		...overrides,
	});

	test('posts to the sync host on API v2 with version and wait in the query', async () => {
		const { output, requests } = await run({
			params: params({ options: { metadata: '{"order": 7}', expiresIn: '3600', outputFormats: ['pdf', 'png'] } }),
			responses: [{ statusCode: 201, body: submission() }],
		});
		assert.equal(requests.length, 1);
		const [request] = requests;
		assert.equal(request.credentialType, 'docSpringApi');
		assert.equal(request.method, 'POST');
		assert.equal(request.url, 'https://sync.api.docspring.com/api/v2/templates/tpl_123/submissions');
		assert.deepEqual(request.qs, { version: '1.2.0', wait: true });
		assert.deepEqual(request.body, {
			data: { first_name: 'Jane', age: 41 },
			expires_in: 3600,
			metadata: { order: 7 },
			output_formats: ['pdf', 'png'],
		});
		assert.equal(request.headers['User-Agent'], USER_AGENT);
		assert.equal(request.ignoreHttpStatusErrors, true);
		assert.deepEqual(output, [submission()]);
	});

	test('sends test only when it is true', async () => {
		const live = await run({ params: params({ test: false }), responses: [{ statusCode: 201, body: submission() }] });
		assert.equal('test' in live.requests[0].body, false);

		const liveFromExpression = await run({
			params: params({ test: 'false' }),
			responses: [{ statusCode: 201, body: submission() }],
		});
		assert.equal('test' in liveFromExpression.requests[0].body, false);

		const testRun = await run({ params: params({ test: 'true' }), responses: [{ statusCode: 201, body: submission() }] });
		assert.equal(testRun.requests[0].body.test, true);
	});

	test('sends wait=false when waiting is turned off, and leaves out an empty version', async () => {
		const { requests } = await run({
			params: params({ templateVersion: '', options: { wait: false } }),
			responses: [{ statusCode: 201, body: submission({ state: 'pending' }) }],
		});
		assert.deepEqual(requests[0].qs, { wait: false });
	});

	test('rejects an Expires In that is not a whole number', async () => {
		await assert.rejects(run({ params: params({ options: { expiresIn: 'soon' } }) }), /Expires In must be a whole number/);
	});

	test('rejects metadata that is not a JSON object', async () => {
		await assert.rejects(run({ params: params({ options: { metadata: '[1, 2]' } }) }), /Metadata must be a JSON object/);
	});

	test('fails when the PDF comes back in a failure state', async () => {
		await assert.rejects(
			run({
				params: params(),
				responses: [{ statusCode: 201, body: submission({ state: 'image_download_failed', error_message: "Couldn't download logo.png" }) }],
			}),
			(error) => {
				assert.equal(
					error.message,
					"DocSpring couldn't generate the PDF (state: image_download_failed): Couldn't download logo.png",
				);
				assert.equal(error.description, 'Submission: sub_1');
				return true;
			},
		);
	});
});

describe('API errors', () => {
	const params = {
		resource: 'submission',
		operation: 'get',
		submissionId: 'sub_1',
	};

	test('show the code, message, details, record ID and request ID', async () => {
		const body = {
			error: {
				code: 'invalid_data',
				message: "The data doesn't match the template's fields: /data/last_name is required",
				details: [
					{ code: 'required', message: 'is required', pointer: '/data/last_name' },
					{ code: 'type', message: 'must be a boolean', parameter: 'test' },
					{ code: 'other', message: 'is invalid' },
				],
				request_id: 'req_1',
				submission_id: 'sub_9',
			},
		};
		await assert.rejects(run({ params, responses: [{ statusCode: 422, body }] }), (error) => {
			assert.equal(error.constructor.name, 'NodeApiError');
			assert.equal(error.httpCode, '422');
			assert.equal(
				error.message,
				"DocSpring API error 422 invalid_data: The data doesn't match the template's fields: /data/last_name is required",
			);
			assert.equal(
				error.description,
				['/data/last_name: is required', 'test: must be a boolean', 'is invalid', 'Submission: sub_9', 'Request ID: req_1'].join(
					'\n',
				),
			);
			assert.doesNotMatch(`${error.message}\n${error.description}`, /\[object Object\]/);
			return true;
		});
	});

	test('a polling timeout says how to get the PDF later', async () => {
		const body = {
			error: { code: 'polling_timeout', message: 'Timed out', details: [], request_id: 'req_2', submission_id: 'sub_7' },
		};
		await assert.rejects(run({ params, responses: [{ statusCode: 504, body }] }), (error) => {
			assert.equal(
				error.message,
				"The PDF wasn't ready in time. Get it later with Get Submission (sub_7), or use the submission.processed trigger.",
			);
			assert.equal(error.description, 'Request ID: req_2');
			return true;
		});
	});

	test('a self-hosted server without API v2 gets the upgrade message', async () => {
		const credentials = { region: 'self_hosted', customHost: 'docspring.example.com/', tokenId: 'a', tokenSecret: 'b' };
		await assert.rejects(
			run({ params, credentials, responses: [{ statusCode: 404, body: '<html>Not Found</html>' }] }),
			(error) => {
				assert.equal(
					error.message,
					"This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version 0.1.4 of this integration.",
				);
				return true;
			},
		);
	});

	test('self-hosted requests go to the custom host', async () => {
		const credentials = { region: 'self_hosted', customHost: ' docspring.example.com/ ', tokenId: 'a', tokenSecret: 'b' };
		const { requests } = await run({ params, credentials, responses: [{ body: submission() }] });
		assert.equal(requests[0].url, 'https://docspring.example.com/api/v2/submissions/sub_1');
	});

	test('EU requests go to the EU hosts', async () => {
		const credentials = { region: 'eu', tokenId: 'a', tokenSecret: 'b' };
		const { requests } = await run({ params, credentials, responses: [{ body: submission() }] });
		assert.equal(requests[0].url, 'https://api-eu.docspring.com/api/v2/submissions/sub_1');
	});

	test('continueOnFail outputs the whole error text', async () => {
		const body = { error: { code: 'not_found', message: 'No submission', details: [], request_id: 'req_3' } };
		const { output } = await run({ params, continueOnFail: true, responses: [{ statusCode: 404, body }] });
		assert.deepEqual(output, [{ error: 'DocSpring API error 404 not_found: No submission\nRequest ID: req_3' }]);
	});
});

describe('Submission: other operations', () => {
	test('Get Many maps the filters to API v2 query parameters and follows the cursor up to the limit', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'submission',
				operation: 'getMany',
				templateId: TEMPLATE,
				returnAll: false,
				limit: 3,
				filters: { mode: 'test', createdAfter: '2025-01-31T09:00:00', includeData: true },
			},
			timezone: 'Pacific/Auckland',
			responses: [
				{ body: { data: [{ id: 'sub_a' }, { id: 'sub_b' }], next_cursor: 'sub_b' } },
				{ body: { data: [{ id: 'sub_c' }, { id: 'sub_d' }], next_cursor: 'sub_d' } },
			],
		});
		assert.deepEqual(
			output.map((item) => item.id),
			['sub_a', 'sub_b', 'sub_c'],
		);
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/submissions');
		assert.deepEqual(requests[0].qs, {
			template_id: 'tpl_123',
			test: true,
			created_after: '2025-01-30T20:00:00Z',
			include_data: true,
			limit: 3,
		});
		assert.deepEqual(requests[1].qs, { ...requests[0].qs, limit: 1, cursor: 'sub_b' });
	});

	test('Get Many with Live Only sends test=false', async () => {
		const { requests } = await run({
			params: {
				resource: 'submission',
				operation: 'getMany',
				templateId: { mode: 'list', value: '' },
				returnAll: true,
				filters: { mode: 'live', createdBefore: '2025-06-01T00:00:00+02:00' },
			},
			responses: [{ body: { data: [{ id: 'sub_a' }], next_cursor: null } }],
		});
		assert.deepEqual(requests[0].qs, { test: false, created_before: '2025-06-01T00:00:00+02:00', limit: 100 });
	});

	test('Check Data validates with signature requests and returns the result', async () => {
		const result = { valid: false, template_id: 'tpl_123', template_version: null, error: { code: 'invalid_data' } };
		const { output, requests } = await run({
			params: {
				resource: 'submission',
				operation: 'checkData',
				templateId: TEMPLATE,
				templateVersion: 'draft',
				templateData: { value: { first_name: 'Jane' } },
				test: true,
				signers: { signer: [{ email: 'jane@example.com', fields: 'signature, date', authType: 'email_link' }] },
			},
			responses: [{ body: result }],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/submissions/validate');
		assert.deepEqual(requests[0].qs, { version: 'draft' });
		assert.deepEqual(requests[0].body, {
			data: { first_name: 'Jane' },
			test: true,
			signature_requests: [{ fields: ['signature', 'date'], auth_type: 'email_link', email: 'jane@example.com' }],
		});
		assert.deepEqual(output, [result]);
	});

	test('Generate Files asks the sync host for the formats and fails when one could not be made', async () => {
		const failed = submission({ files: { png: { state: 'error', error_message: 'Too many pages' } } });
		await assert.rejects(
			run({
				params: { resource: 'submission', operation: 'generateFiles', submissionId: 'sub_1', formats: ['png'], options: {} },
				responses: [{ body: failed }],
			}),
			/couldn't make the png files \(state: error\): Too many pages/,
		);
		const { requests } = await run({
			params: { resource: 'submission', operation: 'generateFiles', submissionId: 'sub_1', formats: ['png'], options: {} },
			responses: [{ body: submission() }],
		});
		assert.equal(requests[0].url, 'https://sync.api.docspring.com/api/v2/submissions/sub_1/generate_files');
		assert.deepEqual(requests[0].qs, { wait: true });
		assert.deepEqual(requests[0].body, { formats: ['png'] });
	});

	test('Expire deletes the submission', async () => {
		const { requests } = await run({
			params: { resource: 'submission', operation: 'expire', submissionId: 'sub_1' },
			responses: [{ body: submission({ expired: true }) }],
		});
		assert.equal(requests[0].method, 'DELETE');
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/submissions/sub_1');
	});
});

describe('Submission Batch', () => {
	test('Create sends a flat batch to the sync host', async () => {
		const { requests } = await run({
			params: {
				resource: 'submissionBatch',
				operation: 'create',
				templateId: TEMPLATE,
				templateVersion: '',
				test: true,
				submissions: '[{"data": {"name": "A"}}, {"data": {"name": "B"}, "metadata": {"row": 2}}]',
				options: { metadata: '{}' },
			},
			responses: [{ statusCode: 201, body: { id: 'sbb_1', state: 'processed', submissions: [] } }],
		});
		assert.equal(requests[0].url, 'https://sync.api.docspring.com/api/v2/submissions/batches');
		assert.deepEqual(requests[0].qs, { wait: true });
		assert.deepEqual(requests[0].body, {
			template_id: 'tpl_123',
			test: true,
			submissions: [{ data: { name: 'A' } }, { data: { name: 'B' }, metadata: { row: 2 } }],
		});
	});

	test('Create fails when PDFs in the batch failed', async () => {
		const batch = {
			id: 'sbb_1',
			state: 'error',
			total_count: 2,
			submissions: [
				{ id: 'sub_a', state: 'processed' },
				{ id: 'sub_b', state: 'error', error_message: 'Boom' },
			],
		};
		await assert.rejects(
			run({
				params: {
					resource: 'submissionBatch',
					operation: 'create',
					templateId: TEMPLATE,
					templateVersion: '',
					test: false,
					submissions: [{ data: {} }, { data: {} }],
					options: {},
				},
				responses: [{ statusCode: 201, body: batch }],
			}),
			(error) => {
				assert.equal(error.message, "DocSpring couldn't generate 1 of the 2 PDFs in the batch (state: error)");
				assert.equal(error.description, 'sub_b (state: error): Boom\nSubmission batch: sbb_1');
				return true;
			},
		);
	});
});

describe('Combined PDF', () => {
	test('Combine PDFs posts each source with only its own properties', async () => {
		const { requests } = await run({
			params: {
				resource: 'combinedPdf',
				operation: 'create',
				sourcePdfs: {
					pdf: [
						{ type: 'submission', id: 'sub_1', templateVersion: '', processed: true },
						{ type: 'combined_pdf', id: 'com_1', templateVersion: '2.0.0' },
						{ type: 'template', id: 'tpl_1', templateVersion: '1.0.0', processed: false },
						{ type: 'template', id: 'tpl_2', templateVersion: '', processed: true },
						{ type: 'url', url: 'https://example.com/a.pdf', id: 'ignored' },
					],
				},
				options: { password: 'hunter2', expiresIn: 600 },
			},
			responses: [{ statusCode: 201, body: { id: 'com_9', state: 'processed' } }],
		});
		assert.equal(requests[0].url, 'https://sync.api.docspring.com/api/v2/combined_pdfs');
		assert.deepEqual(requests[0].qs, { wait: true });
		assert.deepEqual(requests[0].body, {
			source_pdfs: [
				{ type: 'submission', id: 'sub_1' },
				{ type: 'combined_pdf', id: 'com_1' },
				{ type: 'template', id: 'tpl_1', template_version: '1.0.0', processed: false },
				{ type: 'template', id: 'tpl_2' },
				{ type: 'url', url: 'https://example.com/a.pdf' },
			],
			password: 'hunter2',
			expires_in: 600,
		});
	});

	test('Combine PDFs fails when the combined PDF failed', async () => {
		await assert.rejects(
			run({
				params: { resource: 'combinedPdf', operation: 'create', sourcePdfs: { pdf: [{ type: 'submission', id: 'sub_1' }] }, options: {} },
				responses: [{ statusCode: 201, body: { id: 'com_9', state: 'error', error_message: 'Bad PDF' } }],
			}),
			/couldn't combine the PDFs \(state: error\): Bad PDF/,
		);
	});
});

describe('Signature Request', () => {
	const createParams = (overrides = {}) => ({
		resource: 'signatureRequest',
		operation: 'create',
		templateId: TEMPLATE,
		templateVersion: '',
		templateData: { value: { company: 'Acme', empty: '' } },
		signers: {
			signer: [
				{
					name: 'Jane',
					email: 'jane@example.com',
					fields: ['signature', 'date'],
					authType: 'email_link',
					role: '',
					authProvider: 'ignored',
					prefilledValuesEditable: true,
					ignoreUnknownFields: false,
				},
				{ email: 'sam@example.com', fields: 'initials', authType: 'oauth', authProvider: 'google' },
			],
		},
		signingLinkType: 'email',
		test: false,
		options: {},
		...overrides,
	});
	const created = submission({
		id: 'sub_2',
		state: 'waiting_for_signature_requests',
		signature_requests: [{ id: 'srq_1' }, { id: 'srq_2' }],
	});

	test('creates the submission on the standard host, then a signing link for each signer', async () => {
		const { output, requests } = await run({
			params: createParams(),
			responses: [
				{ statusCode: 201, body: created },
				{ statusCode: 201, body: { id: 't1', signature_request_url: 'https://app.docspring.com/sign/1' } },
				{ statusCode: 201, body: { id: 't2', signature_request_url: 'https://app.docspring.com/sign/2' } },
			],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/submissions');
		assert.equal(requests[0].qs, undefined);
		assert.deepEqual(requests[0].body, {
			data: { company: 'Acme' },
			signature_requests: [
				{
					fields: ['signature', 'date'],
					auth_type: 'email_link',
					name: 'Jane',
					email: 'jane@example.com',
					prefilled_values_editable: true,
				},
				{ fields: ['initials'], auth_type: 'oauth', email: 'sam@example.com', auth_provider: 'google' },
			],
		});
		assert.equal(requests[1].url, 'https://api.docspring.com/api/v2/signature_requests/srq_1/tokens');
		assert.deepEqual(requests[1].body, { type: 'email' });
		assert.equal(requests[2].url, 'https://api.docspring.com/api/v2/signature_requests/srq_2/tokens');
		assert.deepEqual(output[0].signature_requests, [
			{ id: 'srq_1', signing_url: 'https://app.docspring.com/sign/1' },
			{ id: 'srq_2', signing_url: 'https://app.docspring.com/sign/2' },
		]);
		assert.equal(output[0].first_signature_request_id, 'srq_1');
		assert.equal(output[0].first_signing_url, 'https://app.docspring.com/sign/1');
		assert.equal('data_requests' in output[0], false);
	});

	test('leaves out checkbox fields left blank, and sends true and false as booleans', async () => {
		const { requests } = await run({
			params: createParams({
				templateData: { mappingMode: 'defineBelow', value: { agree: '', subscribe: true, terms: false, company: 'Acme' } },
				signingLinkType: 'none',
			}),
			responses: [{ statusCode: 201, body: created }],
		});
		assert.deepEqual(requests[0].body.data, { subscribe: true, terms: false, company: 'Acme' });
	});

	test('creates no links when Signing Links is None', async () => {
		const { output, requests } = await run({
			params: createParams({ signingLinkType: 'none' }),
			responses: [{ statusCode: 201, body: created }],
		});
		assert.equal(requests.length, 1);
		assert.equal(output[0].first_signing_url, null);
	});

	test('requires fields for each signer, and a provider for OAuth', async () => {
		await assert.rejects(
			run({ params: createParams({ signers: { signer: [{ email: 'a@example.com', fields: [], authType: 'email_link' }] } }) }),
			/Choose the fields that Signer 1 fills in/,
		);
		await assert.rejects(
			run({ params: createParams({ signers: { signer: [{ fields: ['a'], authType: 'oauth', authProvider: ' ' }] } }) }),
			/Signer 1 uses OAuth: enter its Auth Provider/,
		);
		await assert.rejects(run({ params: createParams({ signers: {} }) }), /Add at least one signer/);
	});

	test('says which submission was created when a signing link fails', async () => {
		await assert.rejects(
			run({
				params: createParams(),
				responses: [
					{ statusCode: 201, body: created },
					{ statusCode: 403, body: { error: { code: 'forbidden', message: 'Use a live API token', details: [], request_id: 'req_4' } } },
				],
			}),
			(error) => {
				assert.match(error.message, /DocSpring created submission sub_2, but couldn't create a signing link for signature request srq_1/);
				assert.match(error.description, /DocSpring API error 403 forbidden: Use a live API token/);
				return true;
			},
		);
	});

	test('Create Signing Link sends the type in the body and returns the token', async () => {
		const token = { id: 't1', type: 'api', signature_request_url: 'https://app.docspring.com/sign/1' };
		const { output, requests } = await run({
			params: { resource: 'signatureRequest', operation: 'createSigningLink', signatureRequestId: 'srq_1', linkType: 'api' },
			responses: [{ statusCode: 201, body: token }],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/signature_requests/srq_1/tokens');
		assert.equal(requests[0].qs, undefined);
		assert.deepEqual(requests[0].body, { type: 'api' });
		assert.deepEqual(output, [token]);
	});
});

describe('Template', () => {
	test('Create sends a PDF from a binary field as base64, with field detection', async () => {
		const pdf = Buffer.from('%PDF-1.4 test');
		const { requests } = await run({
			params: {
				resource: 'template',
				operation: 'create',
				name: 'Lease',
				templateType: 'pdf',
				documentSource: 'binary',
				binaryPropertyName: 'data',
				detectFields: true,
				fieldDetectionOptions: { fieldNaming: 'preserve' },
				options: { folderId: 'fld_1' },
			},
			binary: { data: { data: pdf.toString('base64'), fileName: 'lease.pdf', mimeType: 'application/pdf' } },
			responses: [{ statusCode: 201, body: { id: 'tpl_9', document: { state: 'processed' } } }],
		});
		assert.equal(requests[0].url, 'https://sync.api.docspring.com/api/v2/templates');
		assert.deepEqual(requests[0].qs, { wait: true });
		assert.deepEqual(requests[0].body, {
			name: 'Lease',
			template_type: 'pdf',
			document_base64: pdf.toString('base64'),
			filename: 'lease.pdf',
			detect_fields: true,
			field_naming: 'preserve',
			parent_folder_id: 'fld_1',
		});
	});

	test("Create fails when the template's PDF couldn't be processed", async () => {
		await assert.rejects(
			run({
				params: {
					resource: 'template',
					operation: 'create',
					name: 'Lease',
					templateType: 'pdf',
					documentSource: 'url',
					documentUrl: 'https://example.com/lease.pdf',
					detectFields: false,
					options: {},
				},
				responses: [
					{ statusCode: 201, body: { id: 'tpl_9', document: { state: 'download_failed', error_message: '404 from example.com' } } },
				],
			}),
			(error) => {
				assert.equal(error.message, "DocSpring couldn't process the template's PDF (state: download_failed): 404 from example.com");
				assert.equal(error.description, 'Template: tpl_9');
				return true;
			},
		);
	});

	test('Create makes an HTML template without document properties', async () => {
		const { requests } = await run({
			params: {
				resource: 'template',
				operation: 'create',
				name: 'Invoice',
				templateType: 'html',
				html: '<p>{{ name }}</p>',
				scss: '',
				headerHtml: '',
				footerHtml: '<p>Footer</p>',
				options: { wait: false },
			},
			responses: [{ statusCode: 201, body: { id: 'tpl_8', document: null } }],
		});
		assert.deepEqual(requests[0].qs, { wait: false });
		assert.deepEqual(requests[0].body, {
			name: 'Invoice',
			template_type: 'html',
			html: '<p>{{ name }}</p>',
			footer_html: '<p>Footer</p>',
		});
	});

	test('Replace PDF puts a URL on the sync host', async () => {
		const { requests } = await run({
			params: {
				resource: 'template',
				operation: 'replacePdf',
				templateId: TEMPLATE,
				documentSource: 'url',
				documentUrl: 'https://example.com/v2.pdf',
				options: { reimportFields: true, filename: 'v2.pdf' },
			},
			responses: [{ body: { id: 'tpl_123', document: { state: 'processed' } } }],
		});
		assert.equal(requests[0].method, 'PUT');
		assert.equal(requests[0].url, 'https://sync.api.docspring.com/api/v2/templates/tpl_123/document');
		assert.deepEqual(requests[0].body, {
			document_url: 'https://example.com/v2.pdf',
			filename: 'v2.pdf',
			reimport_fields: true,
		});
	});

	test('Move to the root sends a null folder; Copy leaves the folder out unless one is chosen', async () => {
		const moved = await run({
			params: { resource: 'template', operation: 'move', templateId: TEMPLATE, folderId: 'root' },
			responses: [{ body: { id: 'tpl_123' } }],
		});
		assert.deepEqual(moved.requests[0].body, { parent_folder_id: null });

		const copied = await run({
			params: { resource: 'template', operation: 'copy', templateId: TEMPLATE, options: { name: 'Copy' } },
			responses: [{ statusCode: 201, body: { id: 'tpl_124' } }],
		});
		assert.deepEqual(copied.requests[0].body, { name: 'Copy' });

		const copiedToRoot = await run({
			params: { resource: 'template', operation: 'copy', templateId: TEMPLATE, options: { folderId: 'root', version: '1.0.0' } },
			responses: [{ statusCode: 201, body: { id: 'tpl_125' } }],
		});
		assert.deepEqual(copiedToRoot.requests[0].body, { parent_folder_id: null, version: '1.0.0' });
	});

	test('Get Many filters by name and folder', async () => {
		const { output, requests } = await run({
			params: { resource: 'template', operation: 'getMany', returnAll: true, filters: { query: 'lease', folderId: 'fld_1' } },
			responses: [{ body: { data: [{ id: 'tpl_1' }], next_cursor: null } }],
		});
		assert.deepEqual(requests[0].qs, { query: 'lease', parent_folder_id: 'fld_1', limit: 100 });
		assert.deepEqual(output, [{ id: 'tpl_1' }]);
	});

	test('Publish Version sends the version type and description', async () => {
		const { requests } = await run({
			params: {
				resource: 'template',
				operation: 'publishVersion',
				templateId: TEMPLATE,
				versionType: 'minor',
				versionDescription: 'New fields',
			},
			responses: [{ statusCode: 201, body: { version: '1.1.0' } }],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/publish_version');
		assert.deepEqual(requests[0].body, { version_type: 'minor', description: 'New fields' });
	});
});

describe('Template Field and Folder', () => {
	test('Get Many returns one item per field', async () => {
		const { output, requests } = await run({
			params: { resource: 'templateField', operation: 'getMany', templateId: TEMPLATE, templateVersion: '' },
			responses: [{ body: { template_id: 'tpl_123', version: null, fields: [{ id: 1 }, { id: 2 }] } }],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/fields');
		assert.deepEqual(output, [{ id: 1 }, { id: 2 }]);
	});

	test('Add and Update send the fields array; Remove sends integer field IDs', async () => {
		const added = await run({
			params: { resource: 'templateField', operation: 'add', templateId: TEMPLATE, fields: '[{"name": "a", "type": "string"}]' },
			responses: [{ statusCode: 201, body: { fields: [] } }],
		});
		assert.equal(added.requests[0].method, 'POST');
		assert.deepEqual(added.requests[0].body, { fields: [{ name: 'a', type: 'string' }] });

		const updated = await run({
			params: { resource: 'templateField', operation: 'update', templateId: TEMPLATE, fields: { fields: [{ id: 3, required: false }] } },
			responses: [{ body: { fields: [] } }],
		});
		assert.equal(updated.requests[0].method, 'PUT');
		assert.deepEqual(updated.requests[0].body, { fields: [{ id: 3, required: false }] });

		const removed = await run({
			params: { resource: 'templateField', operation: 'remove', templateId: TEMPLATE, fieldIds: ['3', 4] },
			responses: [{ body: { fields: [] } }],
		});
		assert.equal(removed.requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/fields/remove');
		assert.deepEqual(removed.requests[0].body, { field_ids: [3, 4] });

		await assert.rejects(
			run({ params: { resource: 'templateField', operation: 'add', templateId: TEMPLATE, fields: '[]' } }),
			/Fields must be a JSON array with at least one object/,
		);
	});

	test('Folders: Create in a parent folder, Get Many in a folder', async () => {
		const created = await run({
			params: { resource: 'folder', operation: 'create', name: 'Leases', options: { parentFolderId: 'fld_1' } },
			responses: [{ statusCode: 201, body: { id: 'fld_2' } }],
		});
		assert.deepEqual(created.requests[0].body, { name: 'Leases', parent_folder_id: 'fld_1' });

		const listed = await run({
			params: { resource: 'folder', operation: 'getMany', returnAll: false, limit: 5, filters: { parentFolderId: 'fld_1' } },
			responses: [{ body: { data: [{ id: 'fld_2' }], next_cursor: null } }],
		});
		assert.deepEqual(listed.requests[0].qs, { parent_folder_id: 'fld_1', limit: 5 });
	});
});

describe('IDs in paths', () => {
	const cases = [
		['Submission ID', { resource: 'submission', operation: 'get', submissionId: '..' }],
		['Submission ID', { resource: 'submission', operation: 'expire', submissionId: ' .. ' }],
		['Submission ID', { resource: 'submission', operation: 'generateFiles', submissionId: '.', formats: ['png'], options: {} }],
		['Submission Batch ID', { resource: 'submissionBatch', operation: 'get', submissionBatchId: '..', options: {} }],
		['Combined PDF ID', { resource: 'combinedPdf', operation: 'get', combinedPdfId: '.' }],
		['Signature Request ID', { resource: 'signatureRequest', operation: 'get', signatureRequestId: '..' }],
		['Signature Request ID', { resource: 'signatureRequest', operation: 'createSigningLink', signatureRequestId: '..', linkType: 'api' }],
		['Template ID', { resource: 'template', operation: 'get', templateId: { mode: 'id', value: '..' }, templateVersion: '' }],
		['Template ID', { resource: 'template', operation: 'move', templateId: { mode: 'id', value: '.' }, folderId: 'root' }],
		[
			'Template ID',
			{
				resource: 'submission',
				operation: 'generatePdf',
				templateId: { mode: 'id', value: ' .. ' },
				templateVersion: '',
				templateData: { value: {} },
				test: false,
				options: {},
			},
		],
		['Template ID', { resource: 'templateField', operation: 'remove', templateId: { mode: 'id', value: '..' }, fieldIds: [1] }],
	];

	for (const [label, params] of cases) {
		test(`${params.resource}:${params.operation} rejects a ${label} of "." or ".." before any request`, async () => {
			const { context, http } = createExecuteContext({ params, responses: [{ body: {} }, { body: {} }] });
			await assert.rejects(new DocSpring().execute.call(context), (error) => {
				assert.match(error.message, new RegExp(`^${label} can't be "\\.\\.?"`));
				return true;
			});
			assert.equal(http.requests.length, 0);
		});
	}

	test('IDs with slashes and dots are encoded', async () => {
		const { requests } = await run({
			params: { resource: 'submission', operation: 'get', submissionId: '../templates/tpl_1' },
			responses: [{ body: submission() }],
		});
		assert.equal(requests[0].url, 'https://api.docspring.com/api/v2/submissions/..%2Ftemplates%2Ftpl_1');
	});
});

describe('rate limits', () => {
	const GenericFunctions = require('../dist/nodes/DocSpring/GenericFunctions.js');
	const rateLimited = (retryAfter) => ({
		statusCode: 429,
		headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
		body: {
			error: {
				code: 'rate_limited',
				message: 'This account has made too many API requests. Try again in 12 seconds (the Retry-After header).',
				details: [],
				request_id: 'req_429',
			},
		},
	});
	const generatePdfParams = {
		resource: 'submission',
		operation: 'generatePdf',
		templateId: TEMPLATE,
		templateVersion: '',
		templateData: { value: { first_name: 'Jane' } },
		test: true,
		options: {},
	};

	// Records each wait instead of sleeping, so the suite stays fast.
	async function withWaits(fn) {
		const retry = GenericFunctions.rateLimitRetry || {};
		const original = retry.wait;
		const waits = [];
		retry.wait = async (seconds) => {
			waits.push(seconds);
		};
		try {
			return await fn(waits);
		} finally {
			retry.wait = original;
		}
	}

	test('a 429 waits for Retry-After (rounded up) and sends the same request again', async () => {
		await withWaits(async (waits) => {
			const { output, requests } = await run({
				params: generatePdfParams,
				responses: [rateLimited('2.3'), { statusCode: 201, body: submission() }],
			});
			assert.deepEqual(waits, [3]);
			assert.equal(requests.length, 2);
			assert.equal(requests[1].method, requests[0].method);
			assert.equal(requests[1].url, requests[0].url);
			assert.deepEqual(requests[1].qs, requests[0].qs);
			assert.deepEqual(requests[1].body, requests[0].body);
			assert.deepEqual(output, [submission()]);
		});
	});

	test('waits 1 second when Retry-After is missing or 0, and fails with the API error after 3 retries', async () => {
		await withWaits(async (waits) => {
			const { context, http } = createExecuteContext({
				params: generatePdfParams,
				responses: [rateLimited(), rateLimited('0'), rateLimited(), rateLimited('1')],
			});
			await assert.rejects(new DocSpring().execute.call(context), (error) => {
				assert.equal(error.constructor.name, 'NodeApiError');
				assert.equal(error.httpCode, '429');
				assert.match(error.message, /^DocSpring API error 429 rate_limited: This account has made too many API requests/);
				assert.match(error.description, /Request ID: req_429/);
				return true;
			});
			assert.equal(http.requests.length, 4);
			assert.deepEqual(waits, [1, 1, 1]);
		});
	});

	test("doesn't wait more than 60 seconds", async () => {
		await withWaits(async (waits) => {
			const { context, http } = createExecuteContext({
				params: generatePdfParams,
				responses: [rateLimited('61'), { statusCode: 201, body: submission() }],
			});
			await assert.rejects(new DocSpring().execute.call(context), /DocSpring API error 429 rate_limited/);
			assert.equal(http.requests.length, 1);
			assert.deepEqual(waits, []);
		});
	});

	test("a signing link retries a 429, and still names the submission when it can't", async () => {
		const params = {
			resource: 'signatureRequest',
			operation: 'create',
			templateId: TEMPLATE,
			templateVersion: '',
			templateData: { value: {} },
			signers: { signer: [{ email: 'jane@example.com', fields: ['signature'], authType: 'email_link' }] },
			signingLinkType: 'email',
			test: true,
			options: {},
		};
		const created = submission({ id: 'sub_2', state: 'waiting_for_signature_requests', signature_requests: [{ id: 'srq_1' }] });
		await withWaits(async (waits) => {
			const { output, requests } = await run({
				params,
				responses: [
					{ statusCode: 201, body: created },
					rateLimited('12'),
					{ statusCode: 201, body: { id: 't1', signature_request_url: 'https://app.docspring.com/sign/1' } },
				],
			});
			assert.deepEqual(waits, [12]);
			assert.equal(requests.length, 3);
			assert.equal(output[0].first_signing_url, 'https://app.docspring.com/sign/1');
		});
		await withWaits(async () => {
			await assert.rejects(
				run({
					params,
					responses: [{ statusCode: 201, body: created }, rateLimited('5'), rateLimited('5'), rateLimited('5'), rateLimited('5')],
				}),
				(error) => {
					assert.match(error.message, /DocSpring created submission sub_2, but couldn't create a signing link for signature request srq_1/);
					assert.match(error.description, /DocSpring API error 429 rate_limited/);
					return true;
				},
			);
		});
	});
});
