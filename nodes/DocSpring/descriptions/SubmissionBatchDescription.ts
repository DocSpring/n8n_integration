import type { INodeProperties } from 'n8n-workflow';

import { metadataOption, submissionTemplateVersion, templateLocator, testField, waitOption } from './SharedDescription';

export const submissionBatchOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['submissionBatch'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Generate a batch of PDF files',
				description: 'Generate up to 50 PDFs in one request',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a submission batch',
				description: 'Get a submission batch by ID',
			},
		],
		default: 'create',
	},
];

const create = { resource: ['submissionBatch'], operation: ['create'] };
const get = { resource: ['submissionBatch'], operation: ['get'] };

export const submissionBatchFields: INodeProperties[] = [
	templateLocator(create, {
		description: "The template for each submission that doesn't name its own template",
	}),
	submissionTemplateVersion(create),
	testField(create),
	{
		displayName: 'Submissions',
		name: 'submissions',
		type: 'json',
		required: true,
		default: '[\n  {\n    "data": {}\n  }\n]',
		description:
			'A JSON array of up to 50 submissions. Each one takes data, metadata, field_overrides, test, editable, password, expires_in, output_formats, template_id and template_version.',
		displayOptions: { show: create },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: create },
		options: [
			{ ...metadataOption, description: 'Your own data about the batch, such as an ID from your app (a JSON object)' },
			{
				displayName: 'Output Formats',
				name: 'outputFormats',
				type: 'multiOptions',
				options: [
					{ name: 'PDF', value: 'pdf' },
					{ name: 'PNG Page Images', value: 'png', description: 'An image of each page, up to 100 pages' },
				],
				default: ['pdf'],
				description: "What each submission makes, unless it sets its own output_formats",
			},
			waitOption(
				'Wait for PDFs',
				'Whether to wait until every PDF has been generated. Turn it off to get the pending batch straight away.',
			),
		],
	},
	{
		displayName: 'Submission Batch ID',
		name: 'submissionBatchId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'sbb_1234567890abcdef01',
		displayOptions: { show: get },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: get },
		options: [
			{
				displayName: 'Include Data',
				name: 'includeData',
				type: 'boolean',
				default: false,
				description: "Whether to include each submission's data (null without it)",
			},
		],
	},
];
