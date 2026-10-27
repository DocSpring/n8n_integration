'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createLoadOptionsContext } = require('./helpers');
const { DocSpring } = require('../dist/nodes/DocSpring/DocSpring.node.js');
const { DocSpringTrigger } = require('../dist/nodes/DocSpring/DocSpringTrigger.node.js');

const { methods } = new DocSpring();
const TEMPLATE = { __rl: true, mode: 'list', value: 'tpl_123' };

const SCHEMA = {
	type: 'object',
	properties: {
		first_name: { type: 'string' },
		start_date: { type: 'string', format: 'date' },
		signed_at: { type: ['string', 'null'], format: 'date-time' },
		amount: { type: 'number' },
		agree: { type: 'boolean' },
		plan: { type: ['string', 'null'], enum: ['basic', 'pro', null] },
		client: { type: 'object', properties: { address: { type: 'string' }, 'a/b': { type: 'string' } } },
	},
	required: ['first_name', 'start_date'],
};

describe('pickers', () => {
	test('the template picker searches by name and pages by cursor', async () => {
		const { context, http } = createLoadOptionsContext({
			responses: [{ body: { data: [{ id: 'tpl_1', name: 'Lease' }, { id: 'tpl_2', name: null }], next_cursor: 'tpl_2' } }],
		});
		const result = await methods.listSearch.searchTemplates.call(context, 'lease', 'tpl_0');
		assert.equal(http.requests[0].url, 'https://api.docspring.com/api/v2/templates');
		assert.deepEqual(http.requests[0].qs, { limit: 100, query: 'lease', cursor: 'tpl_0' });
		assert.deepEqual(result, {
			results: [
				{ name: 'Lease', value: 'tpl_1' },
				{ name: 'tpl_2', value: 'tpl_2' },
			],
			paginationToken: 'tpl_2',
		});
	});

	test('the folder pickers page through every folder and show paths, with a root option where it applies', async () => {
		const { context, http } = createLoadOptionsContext({
			responses: [
				{ body: { data: [{ id: 'fld_2', name: 'Leases', path: '/Contracts' }], next_cursor: 'fld_2' } },
				{ body: { data: [{ id: 'fld_1', name: 'Contracts', path: '/' }], next_cursor: null } },
			],
		});
		const options = await methods.loadOptions.getFoldersWithRoot.call(context);
		assert.deepEqual(options, [
			{ name: '/ (Root)', value: 'root' },
			{ name: '/Contracts', value: 'fld_1' },
			{ name: '/Contracts/Leases', value: 'fld_2' },
		]);
		assert.deepEqual(http.requests[1].qs, { limit: 100, cursor: 'fld_2' });
	});

	test("the trigger's template picker stops after 1,000 items", async () => {
		const page = (start) => ({
			body: {
				data: Array.from({ length: 100 }, (_, index) => ({ id: `tpl_${start + index}`, name: `T${start + index}` })),
				next_cursor: `tpl_${start + 99}`,
			},
		});
		const responses = Array.from({ length: 11 }, (_, index) => page(index * 100));
		const { context, http } = createLoadOptionsContext({ responses });
		const options = await new DocSpringTrigger().methods.loadOptions.getTemplates.call(context);
		assert.equal(options.length, 1000);
		assert.equal(http.requests.length, 10);
	});

	test("the signers' field picker lists the names of the template's fields at the chosen version", async () => {
		const fields = [
			{ id: 1, name: 'first_name', type: 'string' },
			{ id: 2, name: 'items/0/price', type: 'number' },
			{ id: 3, name: 'first_name', type: 'string' },
			{ id: 4, name: 'logo', type: 'image', static: true },
			{ id: 5, name: 'full_name', type: 'combined' },
			{ id: 6, name: '@@signature_requests/0/signed_at', type: 'date' },
			{ id: 7, name: null, type: 'string' },
			{ id: 8, name: 'signature', type: 'signature' },
		];
		const { context, http } = createLoadOptionsContext({
			params: { templateId: TEMPLATE, templateVersion: '2.0.0' },
			responses: [{ body: { template_id: 'tpl_123', version: '2.0.0', fields } }],
		});
		const options = await methods.loadOptions.getTemplateFieldNames.call(context);
		assert.equal(http.requests[0].method, 'GET');
		assert.equal(http.requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/fields');
		assert.deepEqual(http.requests[0].qs, { version: '2.0.0' });
		assert.deepEqual(options, [
			{ name: 'first_name', value: 'first_name' },
			{ name: 'items/0/price', value: 'items/0/price' },
			{ name: 'signature', value: 'signature' },
		]);
	});

	test("the signers' field picker reads the latest version when none is chosen", async () => {
		const { context, http } = createLoadOptionsContext({
			params: { templateId: TEMPLATE, templateVersion: ' ' },
			responses: [{ body: { template_id: 'tpl_123', version: '1.0.0', fields: [{ id: 1, name: 'a' }] } }],
		});
		const options = await methods.loadOptions.getTemplateFieldNames.call(context);
		assert.deepEqual(http.requests[0].qs, { version: 'latest' });
		assert.deepEqual(options, [{ name: 'a', value: 'a' }]);
	});

	test("the signers' field picker is empty until a template is chosen", async () => {
		const { context, http } = createLoadOptionsContext({ params: { templateId: { mode: 'list', value: '' }, templateVersion: '' } });
		assert.deepEqual(await methods.loadOptions.getTemplateFieldNames.call(context), []);
		assert.equal(http.requests.length, 0);
	});

	test("the signers' field picker refreshes when the template or version changes", () => {
		for (const [operation, property] of [
			['create', 'signers'],
			['checkData', 'signers'],
		]) {
			const signers = new DocSpring().description.properties.find(
				(p) => p.name === property && p.displayOptions.show.operation.includes(operation),
			);
			const fields = signers.options[0].values.find((value) => value.name === 'fields');
			assert.equal(fields.typeOptions.loadOptionsMethod, 'getTemplateFieldNames');
			assert.deepEqual(fields.typeOptions.loadOptionsDependsOn, ['templateId.value', 'templateVersion']);
		}
	});
});

describe('template data fields', () => {
	test('come from the schema at the chosen version, with date fields as YYYY-MM-DD text', async () => {
		const { context, http } = createLoadOptionsContext({
			params: { templateId: TEMPLATE, templateVersion: '' },
			responses: [{ body: SCHEMA }],
		});
		const { fields } = await methods.resourceMapping.getTemplateFields.call(context);
		assert.equal(http.requests[0].qs, undefined);
		const byId = Object.fromEntries(fields.map((field) => [field.id, field]));
		assert.equal(byId.first_name.type, 'string');
		assert.equal(byId.first_name.required, true);
		assert.equal(byId.start_date.type, 'string');
		assert.equal(byId.start_date.displayName, 'start_date (YYYY-MM-DD)');
		assert.equal(byId.signed_at.type, 'dateTime');
		assert.equal(byId.amount.type, 'number');
		assert.equal(byId.agree.type, 'options');
		assert.equal(byId.plan.type, 'options');
		assert.deepEqual(byId.plan.options, [
			{ name: 'basic', value: 'basic' },
			{ name: 'pro', value: 'pro' },
		]);
		assert.equal(byId.client.type, 'object');
	});

	test('make checkbox (boolean) fields a Leave Blank, True or False choice', async () => {
		const { context } = createLoadOptionsContext({ params: { templateId: TEMPLATE, templateVersion: '' }, responses: [{ body: SCHEMA }] });
		const { fields } = await methods.resourceMapping.getTemplateFieldsOptional.call(context);
		const agree = fields.find((field) => field.id === 'agree');
		assert.equal(agree.type, 'options');
		assert.deepEqual(
			agree.options.map((option) => [option.name, option.value]),
			[
				['Leave Blank', ''],
				['True', true],
				['False', false],
			],
		);
	});

	// n8n's resource mapper fills in a default for every field when it adds all fields. This is getDefaultFieldValue
	// from n8n's ResourceMapper.vue (master, October 2026): a field's defaultValue when it has one, false for a boolean
	// field (which API v2 would treat as a prefilled value) and null (left out) for every other type.
	function n8nDefaultFieldValue(field) {
		if (field.defaultValue !== undefined) return field.defaultValue;
		if (field.type === 'boolean') return false;
		return null;
	}

	test('start blank in every mapper, so no value is sent until the user sets one', async () => {
		for (const method of ['getTemplateFields', 'getTemplateFieldsOptional']) {
			const { context } = createLoadOptionsContext({ params: { templateId: TEMPLATE, templateVersion: '' }, responses: [{ body: SCHEMA }] });
			const { fields } = await methods.resourceMapping[method].call(context);
			const defaults = Object.fromEntries(fields.map((field) => [field.id, n8nDefaultFieldValue(field)]));
			assert.deepEqual(
				Object.entries(defaults).filter(([, value]) => value !== null),
				[],
				`${method} gives these fields a default value`,
			);
		}
	});

	test('are all optional for signature requests', async () => {
		const { context } = createLoadOptionsContext({ params: { templateId: TEMPLATE, templateVersion: '' }, responses: [{ body: SCHEMA }] });
		const { fields } = await methods.resourceMapping.getTemplateFieldsOptional.call(context);
		assert.ok(fields.every((field) => field.required === false));
	});
});

describe('IDs in paths', () => {
	test('the pickers reject a template ID of "." or ".." before any request', async () => {
		for (const method of [methods.loadOptions.getTemplateFieldNames, methods.resourceMapping.getTemplateFields]) {
			const { context, http } = createLoadOptionsContext({
				params: { templateId: { mode: 'id', value: '..' }, templateVersion: '' },
				responses: [{ body: SCHEMA }],
			});
			await assert.rejects(method.call(context), /Template ID can't be "\.\."/);
			assert.equal(http.requests.length, 0);
		}
	});
});
