import type { INodeProperties } from 'n8n-workflow';

import {
	documentSourceFields,
	folderOptionsField,
	readTemplateVersion,
	returnAllAndLimit,
	templateLocator,
	waitOption,
} from './SharedDescription';

export const templateOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['template'] } },
		options: [
			{
				name: 'Copy',
				value: 'copy',
				action: 'Copy a template',
				description: 'Copy a template, or one of its published versions',
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create a template',
				description: 'Create a PDF template from a PDF, or an HTML template',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a template',
				description: 'Get a template by ID',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many templates',
				description: 'Get many templates',
			},
			{
				name: 'Get Page Images',
				value: 'getPageImages',
				action: 'Get page images of a template',
				description: "Get an image of each page of a template's PDF",
			},
			{
				name: 'Move',
				value: 'move',
				action: 'Move a template',
				description: 'Move a template and its published versions to a folder',
			},
			{
				name: 'Publish Version',
				value: 'publishVersion',
				action: 'Publish a template version',
				description: "Publish the template's draft as a new version",
			},
			{
				name: 'Replace PDF',
				value: 'replacePdf',
				action: 'Replace the PDF of a template',
				description: "Replace a PDF template's PDF, keeping its fields",
			},
		],
		default: 'get',
	},
];

const show = (...operation: string[]) => ({ resource: ['template'], operation });
const createPdf = { resource: ['template'], operation: ['create'], templateType: ['pdf'] };
const createHtml = { resource: ['template'], operation: ['create'], templateType: ['html'] };

export const templateFields: INodeProperties[] = [
	templateLocator(show('copy', 'get', 'getPageImages', 'move', 'publishVersion', 'replacePdf')),
	readTemplateVersion(show('get', 'getPageImages')),

	// ─── Get Many ─────────────────────────────────────────────────────────
	...returnAllAndLimit(show('getMany')),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show('getMany') },
		options: [
			folderOptionsField(
				'Folder Name or ID',
				'folderId',
				'Only get the templates in this folder (not in its subfolders)',
				false,
			),
			{
				displayName: 'Name Contains',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Only get templates whose name contains this text (ignoring case)',
			},
		],
	},

	// ─── Create ───────────────────────────────────────────────────────────
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		description: "The template's name",
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Template Type',
		name: 'templateType',
		type: 'options',
		options: [
			{ name: 'HTML', value: 'html', description: 'A PDF rendered from HTML and SCSS' },
			{ name: 'PDF', value: 'pdf', description: 'Fields placed on a PDF' },
		],
		default: 'pdf',
		description: "It can't be changed after the template is created",
		displayOptions: { show: show('create') },
	},
	...documentSourceFields(createPdf),
	{
		displayName: 'Detect Fields',
		name: 'detectFields',
		type: 'boolean',
		default: false,
		description:
			"Whether to set up the PDF's fields as the \"Automatically detect fields\" upload option does: import or detect them, name them with AI, and set up conditional logic",
		displayOptions: { show: createPdf },
	},
	{
		displayName: 'Field Detection Options',
		name: 'fieldDetectionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { ...createPdf, detectFields: [true] } },
		options: [
			{
				displayName: 'Field Logic',
				name: 'fieldLogic',
				type: 'options',
				options: [
					{ name: 'AI', value: 'ai', description: 'AI sets up conditional logic and required fields' },
					{ name: 'None', value: 'none' },
				],
				default: 'ai',
				description: "Left out, your account's template settings decide",
			},
			{
				displayName: 'Field Naming',
				name: 'fieldNaming',
				type: 'options',
				options: [
					{ name: 'AI', value: 'ai', description: 'AI names the fields and sets their types and settings' },
					{
						name: 'Preserve',
						value: 'preserve',
						description: "Keep the names of the PDF's form fields; AI only names the fields it detected",
					},
				],
				default: 'ai',
			},
			{
				displayName: 'Field Source',
				name: 'fieldSource',
				type: 'options',
				options: [
					{
						name: 'Auto',
						value: 'auto',
						description: "Import a fillable PDF's form fields, and detect the fields of a PDF without them",
					},
					{
						name: 'PDF Detection',
						value: 'pdf_detection',
						description: 'Detect the fields from the page layout, even on a fillable PDF',
					},
					{ name: 'PDF Form Fields', value: 'pdf_form_fields', description: "Only import the PDF's form fields" },
				],
				default: 'auto',
			},
		],
	},
	{
		displayName: 'HTML',
		name: 'html',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		description: 'The HTML of the template, as a Liquid template',
		displayOptions: { show: createHtml },
	},
	{
		displayName: 'SCSS',
		name: 'scss',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		displayOptions: { show: createHtml },
	},
	{
		displayName: 'Header HTML',
		name: 'headerHtml',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'HTML printed at the top of each page',
		displayOptions: { show: createHtml },
	},
	{
		displayName: 'Footer HTML',
		name: 'footerHtml',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'HTML printed at the bottom of each page',
		displayOptions: { show: createHtml },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('create') },
		options: [
			{
				displayName: 'Filename',
				name: 'filename',
				type: 'string',
				default: '',
				placeholder: 'form.pdf',
				description: "The PDF's file name. Left out, it's the binary file's name or the last part of the URL.",
			},
			folderOptionsField('Folder Name or ID', 'folderId', 'The folder to create the template in', false),
			waitOption(
				'Wait for PDF',
				"Whether to wait until DocSpring has processed the template's PDF. Turn it off to get the template straight away.",
			),
		],
	},

	// ─── Replace PDF ──────────────────────────────────────────────────────
	...documentSourceFields(show('replacePdf')),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('replacePdf') },
		options: [
			{
				displayName: 'Filename',
				name: 'filename',
				type: 'string',
				default: '',
				placeholder: 'form.pdf',
				description: "The PDF's file name. Left out, it's the binary file's name or the last part of the URL.",
			},
			{
				displayName: 'Reimport Fields',
				name: 'reimportFields',
				type: 'boolean',
				default: false,
				description: "Whether to replace all of the template's fields with the fillable fields in the new PDF",
			},
			waitOption(
				'Wait for PDF',
				'Whether to wait until DocSpring has processed the new PDF. Turn it off to get the template straight away.',
			),
		],
	},

	// ─── Copy ─────────────────────────────────────────────────────────────
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('copy') },
		options: [
			folderOptionsField(
				'Folder Name or ID',
				'folderId',
				"The folder to put the copy in. Left out, it goes in the template's own folder",
				true,
			),
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Left out, the copy is named after the template, such as "Contract (2)"',
			},
			{
				displayName: 'Version',
				name: 'version',
				type: 'string',
				default: '',
				placeholder: '1.2.0',
				description: 'Copy this published version (1.2.0, or 1 for the latest 1.x.x) instead of the draft',
			},
		],
	},

	// ─── Move ─────────────────────────────────────────────────────────────
	{
		...folderOptionsField('Folder Name or ID', 'folderId', 'The folder to move the template to, or the root', true),
		required: true,
		displayOptions: { show: show('move') },
	},

	// ─── Publish Version ──────────────────────────────────────────────────
	{
		displayName: 'Version Type',
		name: 'versionType',
		type: 'options',
		options: [
			{ name: 'Major', value: 'major', description: 'Such as 1.2.0 to 2.0.0' },
			{ name: 'Minor', value: 'minor', description: 'Such as 1.2.0 to 1.3.0' },
			{ name: 'Patch', value: 'patch', description: 'Such as 1.2.0 to 1.2.1' },
		],
		default: 'patch',
		description: 'Which part of the latest version number to increase',
		displayOptions: { show: show('publishVersion') },
	},
	{
		displayName: 'Description',
		name: 'versionDescription',
		type: 'string',
		default: '',
		description: 'What changed in this version',
		displayOptions: { show: show('publishVersion') },
	},
];
