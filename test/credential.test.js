'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');
const { DocSpringApi } = require('../dist/credentials/DocSpringApi.credentials.js');
const { PACKAGE_VERSION, USER_AGENT } = require('../dist/nodes/DocSpring/version.js');
const { toRfc3339, resolveBaseUrl } = require('../dist/nodes/DocSpring/GenericFunctions.js');
const { NODE } = require('./helpers');

test('the version in the User-Agent matches package.json', () => {
	assert.equal(PACKAGE_VERSION, packageJson.version);
	assert.equal(USER_AGENT, `docspring-n8n/${packageJson.version}`);
});

test('the credential test calls GET /api/v2/authentication and explains a 404', () => {
	const credential = new DocSpringApi();
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(credential.test.request.url, '/authentication');
	assert.match(credential.test.request.baseURL, /\/api\/v2$/);
	assert.doesNotMatch(credential.test.request.baseURL, /api\/v1/);
	assert.deepEqual(credential.test.rules, [
		{
			type: 'responseCode',
			properties: {
				value: 404,
				message:
					"This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version 0.1.4 of this integration.",
			},
		},
	]);
});

test('the credential authenticates with Basic auth and names this package in the User-Agent', () => {
	const { authenticate } = new DocSpringApi();
	assert.deepEqual(authenticate, {
		type: 'generic',
		properties: {
			auth: { username: '={{$credentials.tokenId}}', password: '={{$credentials.tokenSecret}}' },
			headers: { 'User-Agent': USER_AGENT },
		},
	});
});

test('hosts by region', () => {
	assert.equal(resolveBaseUrl({ region: 'us' }, false, NODE), 'https://api.docspring.com');
	assert.equal(resolveBaseUrl({ region: 'us' }, true, NODE), 'https://sync.api.docspring.com');
	assert.equal(resolveBaseUrl({ region: 'eu' }, false, NODE), 'https://api-eu.docspring.com');
	assert.equal(resolveBaseUrl({ region: 'eu' }, true, NODE), 'https://sync.api-eu.docspring.com');
	assert.equal(resolveBaseUrl({ region: 'self_hosted', customHost: 'http://pdf.local:3000/' }, true, NODE), 'http://pdf.local:3000');
	assert.throws(() => resolveBaseUrl({ region: 'self_hosted', customHost: ' ' }, false, NODE), /Self-Hosted Host/);
});

test('date filters become RFC 3339 times in the workflow time zone', () => {
	const convert = (value, zone) => toRfc3339(value, zone, 'Created After', NODE, 0);
	assert.equal(convert('2025-01-31T09:00:00', 'UTC'), '2025-01-31T09:00:00Z');
	assert.equal(convert('2025-01-31T09:00:00', 'Pacific/Auckland'), '2025-01-30T20:00:00Z');
	assert.equal(convert('2025-07-31T09:00:00', 'Pacific/Auckland'), '2025-07-30T21:00:00Z');
	assert.equal(convert('2025-03-09T03:30:00', 'America/New_York'), '2025-03-09T07:30:00Z');
	assert.equal(convert('2025-01-31', 'Europe/Berlin'), '2025-01-30T23:00:00Z');
	assert.equal(convert('2025-01-31T09:00:00+02:00', 'UTC'), '2025-01-31T09:00:00+02:00');
	assert.equal(convert(new Date('2025-01-31T09:00:00Z'), 'UTC'), '2025-01-31T09:00:00.000Z');
	assert.equal(convert({ toISO: () => '2025-01-31T09:00:00.000+13:00' }, 'UTC'), '2025-01-31T09:00:00.000+13:00');
	assert.equal(convert('', 'UTC'), undefined);
	assert.throws(() => convert('next tuesday', 'UTC'), /Created After must be a date and time/);
});
