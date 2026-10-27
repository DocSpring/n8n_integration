import type { INodeProperties } from 'n8n-workflow';

import { readTemplateVersion, templateLocator } from './SharedDescription';

export const templateFieldOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['templateField'] } },
		options: [
			{
				name: 'Add',
				value: 'add',
				action: 'Add fields to a template',
				description: "Add fields to a template's draft",
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many template fields',
				description: 'Get many template fields',
			},
			{
				name: 'Remove',
				value: 'remove',
				action: 'Remove fields from a template',
				description: "Remove fields from a template's draft",
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update fields of a template',
				description: "Change the settings of fields in a template's draft",
			},
		],
		default: 'getMany',
	},
];

const show = (...operation: string[]) => ({ resource: ['templateField'], operation });

export const templateFieldFields: INodeProperties[] = [
	templateLocator(show('add', 'getMany', 'remove', 'update')),
	readTemplateVersion(show('getMany')),
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'json',
		required: true,
		default: '[]',
		description:
			'A JSON array of fields to add, such as [{"name": "first_name", "type": "string", "page": 1, "x": 100, "y": 200, "width": 600, "height": 60}]. Settings left out have their defaults.',
		displayOptions: { show: show('add') },
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'json',
		required: true,
		default: '[]',
		description:
			'A JSON array of changes, each with the ID of the field it changes and the settings to change. Settings left out keep their values.',
		displayOptions: { show: show('update') },
	},
	{
		displayName: 'Field Names or IDs',
		name: 'fieldIds',
		type: 'multiOptions',
		required: true,
		typeOptions: { loadOptionsMethod: 'getTemplateFieldIds', loadOptionsDependsOn: ['templateId.value'] },
		default: [],
		description:
			'The fields to remove. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: show('remove') },
	},
];
