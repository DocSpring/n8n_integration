import type { INodeProperties } from 'n8n-workflow';

import {
	expiresInOption,
	metadataOption,
	outputFormatOptions,
	passwordOption,
	returnAllAndLimit,
	signerEmailFields,
	signersField,
	submissionTemplateVersionOption,
	templateDataMapper,
	templateLocator,
	templateLocatorOption,
	templateVersionOptions,
	testField,
	waitOption,
} from './SharedDescription';

export const submissionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['submission'] } },
		options: [
			{
				name: 'Check Data',
				value: 'checkData',
				action: 'Check data against a template',
				description: "Check data against a template's fields without generating a PDF or using credits",
			},
			{
				name: 'Expire',
				value: 'expire',
				action: 'Expire a submission',
				description: "Delete a submission's data and files now",
			},
			{
				name: 'Generate Files',
				value: 'generateFiles',
				action: 'Generate files for a submission',
				description: "Add PNG images of a processed submission's pages, or a Word template submission's other files",
			},
			{
				name: 'Generate PDF',
				value: 'generatePdf',
				action: 'Generate a PDF',
				description: 'Fill in a template with data and generate a PDF',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a submission',
				description: 'Get a submission by ID',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many submissions',
				description: 'Get many submissions',
			},
		],
		default: 'generatePdf',
	},
];

const generatePdf = { resource: ['submission'], operation: ['generatePdf'] };
const checkData = { resource: ['submission'], operation: ['checkData'] };
const getMany = { resource: ['submission'], operation: ['getMany'] };
const generateFiles = { resource: ['submission'], operation: ['generateFiles'] };

export const submissionFields: INodeProperties[] = [
	// ─── Generate PDF and Check Data ──────────────────────────────────────
	templateLocator({ resource: ['submission'], operation: ['generatePdf', 'checkData'] }),
	templateDataMapper(generatePdf, false),
	templateDataMapper(checkData, true),
	testField({ resource: ['submission'], operation: ['generatePdf', 'checkData'] }),
	signersField(checkData, false),
	...signerEmailFields(checkData),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: generatePdf },
		options: [
			{
				displayName: 'Editable',
				name: 'editable',
				type: 'boolean',
				default: false,
				description:
					"Whether the PDF's text and check fields stay fillable. Left out, the template's setting decides.",
			},
			{
				...passwordOption,
				description:
					"A passphrase that the PDF needs to be opened with. A submission with a passphrase can't make a Word document or OpenDocument file.",
			},
			expiresInOption,
			{
				displayName: 'Field Overrides',
				name: 'fieldOverrides',
				type: 'json',
				default: '{}',
				description:
					'Changes to field settings for this PDF only, by field name, such as {"name": {"required": false, "font_size": 9}}',
			},
			metadataOption,
			{
				displayName: 'Output Formats',
				name: 'outputFormats',
				type: 'multiOptions',
				options: outputFormatOptions,
				default: ['pdf'],
				description:
					"What the submission makes. Leave this option out for what the template makes: the PDF, or what a Word template is set to make. A submission with a PDF passphrase can't make the Word document or OpenDocument file.",
			},
			submissionTemplateVersionOption,
			waitOption(
				'Wait for PDF',
				'Whether to wait until the PDF has been generated. Turn it off to get the pending submission straight away.',
			),
		],
	},
	templateVersionOptions(checkData, submissionTemplateVersionOption),

	// ─── Get, Expire and Generate Files ───────────────────────────────────
	{
		displayName: 'Submission ID',
		name: 'submissionId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'sub_1234567890abcdef01',
		displayOptions: { show: { resource: ['submission'], operation: ['get', 'expire', 'generateFiles'] } },
	},
	{
		displayName: 'Formats',
		name: 'formats',
		type: 'multiOptions',
		required: true,
		options: outputFormatOptions,
		default: ['png'],
		description:
			"The formats to add to the submission's files. PDF, Word Document and OpenDocument File are for the submissions of Word templates.",
		displayOptions: { show: generateFiles },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: generateFiles },
		options: [
			waitOption(
				'Wait for Files',
				'Whether to wait until the files have been made. Turn it off to get the submission straight away.',
			),
		],
	},

	// ─── Get Many ─────────────────────────────────────────────────────────
	...returnAllAndLimit(getMany),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: getMany },
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: "Only get submissions created after this time (in the workflow's time zone unless it has one)",
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description: "Only get submissions created before this time (in the workflow's time zone unless it has one)",
			},
			{
				displayName: 'Include Data',
				name: 'includeData',
				type: 'boolean',
				default: false,
				description: "Whether to include each submission's data (null without it)",
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{ name: 'Live Only', value: 'live' },
					{ name: 'Test Only', value: 'test' },
				],
				default: 'live',
				description: 'Whether to get only live or only test submissions. Leave the filter out to get both.',
			},
			templateLocatorOption("Only get this template's submissions. Leave the filter out to get every template's."),
		],
	},
];
