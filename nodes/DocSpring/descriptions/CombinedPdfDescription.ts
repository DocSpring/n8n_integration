import type { INodeProperties } from 'n8n-workflow';

import { expiresInOption, metadataOption, passwordOption, waitOption } from './SharedDescription';

export const combinedPdfOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['combinedPdf'] } },
		options: [
			{
				name: 'Combine PDFs',
				value: 'create',
				action: 'Combine PDF files',
				description: 'Merge submissions, combined PDFs, templates, files or URLs into one PDF',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a combined PDF',
				description: 'Get a combined PDF by ID',
			},
		],
		default: 'create',
	},
];

const create = { resource: ['combinedPdf'], operation: ['create'] };

export const combinedPdfFields: INodeProperties[] = [
	{
		displayName: 'Source PDFs',
		name: 'sourcePdfs',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		required: true,
		default: {},
		placeholder: 'Add Source PDF',
		description: 'The PDFs to merge, in order',
		displayOptions: { show: create },
		options: [
			{
				name: 'pdf',
				displayName: 'PDF',
				values: [
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						default: '',
						placeholder: 'sub_1234567890abcdef01',
						description: 'The ID of the submission, combined PDF, template or custom file',
						displayOptions: { hide: { type: ['url'] } },
					},
					{
						displayName: 'Processed PDF',
						name: 'processed',
						type: 'boolean',
						default: true,
						description:
							"Whether to merge the template's processed PDF (the one submissions are filled in on). Turn it off to merge the PDF as it was uploaded.",
						displayOptions: { show: { type: ['template'] } },
					},
					{
						displayName: 'Template Version',
						name: 'templateVersion',
						type: 'string',
						default: '',
						placeholder: 'latest',
						description:
							'Leave empty for the latest published version (the draft when none has been published). Enter "draft", "latest" or a version such as 1.2.0.',
						displayOptions: { show: { type: ['template'] } },
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						options: [
							{ name: 'Combined PDF', value: 'combined_pdf' },
							{ name: 'Custom File', value: 'custom_file' },
							{ name: 'Submission', value: 'submission' },
							{ name: 'Template', value: 'template' },
							{ name: 'URL', value: 'url' },
						],
						default: 'submission',
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						placeholder: 'https://example.com/document.pdf',
						description: 'The URL to download the PDF from',
						displayOptions: { show: { type: ['url'] } },
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: create },
		options: [
			passwordOption,
			{
				...expiresInOption,
				description: 'Seconds after the PDF is generated until it is deleted. Left out, it is kept until you delete it.',
			},
			{ ...metadataOption, description: 'Your own data about the combined PDF, such as an ID from your app (a JSON object)' },
			waitOption(
				'Wait for PDF',
				'Whether to wait until the PDF has been generated. Turn it off to get the pending combined PDF straight away.',
			),
		],
	},
	{
		displayName: 'Combined PDF ID',
		name: 'combinedPdfId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'com_1234567890abcdef01',
		displayOptions: { show: { resource: ['combinedPdf'], operation: ['get'] } },
	},
];
