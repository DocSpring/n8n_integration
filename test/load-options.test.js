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

	test("the signers' field picker lists the template's field names at the chosen version", async () => {
		const { context, http } = createLoadOptionsContext({
			params: { templateId: TEMPLATE, templateVersion: '2.0.0' },
			responses: [{ body: SCHEMA }],
		});
		const options = await methods.loadOptions.getTemplateFieldNames.call(context);
		assert.equal(http.requests[0].url, 'https://api.docspring.com/api/v2/templates/tpl_123/schema');
		assert.deepEqual(http.requests[0].qs, { version: '2.0.0' });
		assert.deepEqual(
			options.map((option) => option.value),
			['first_name', 'start_date', 'signed_at', 'amount', 'agree', 'plan', 'client/address', 'client/a~1b'],
		);
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
		assert.equal(byId.agree.type, 'boolean');
		assert.equal(byId.plan.type, 'options');
		assert.deepEqual(byId.plan.options, [
			{ name: 'basic', value: 'basic' },
			{ name: 'pro', value: 'pro' },
		]);
		assert.equal(byId.client.type, 'object');
	});

	test('are all optional for signature requests', async () => {
		const { context } = createLoadOptionsContext({ params: { templateId: TEMPLATE, templateVersion: '' }, responses: [{ body: SCHEMA }] });
		const { fields } = await methods.resourceMapping.getTemplateFieldsOptional.call(context);
		assert.ok(fields.every((field) => field.required === false));
	});
});
