import type { INodeProperties } from 'n8n-workflow';

import { folderOptionsField, returnAllAndLimit } from './SharedDescription';

export const folderOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['folder'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a folder',
				description: 'Create a folder for templates',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many folders',
				description: 'Get many folders',
			},
		],
		default: 'getMany',
	},
];

const show = (...operation: string[]) => ({ resource: ['folder'], operation });

export const folderFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		description: "The folder's name. It can't contain /, and is unique within its parent folder.",
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('create') },
		options: [
			folderOptionsField(
				'Parent Folder Name or ID',
				'parentFolderId',
				'The folder to create it in. Left out, it is created at the root',
				false,
			),
		],
	},
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
				'Parent Folder Name or ID',
				'parentFolderId',
				'Only get the folders in this folder. Left out, every folder at any depth',
				false,
			),
		],
	},
];
