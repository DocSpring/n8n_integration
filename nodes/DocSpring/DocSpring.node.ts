import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { combinedPdfFields, combinedPdfOperations } from './descriptions/CombinedPdfDescription';
import { folderFields, folderOperations } from './descriptions/FolderDescription';
import { signatureRequestFields, signatureRequestOperations } from './descriptions/SignatureRequestDescription';
import { submissionBatchFields, submissionBatchOperations } from './descriptions/SubmissionBatchDescription';
import { submissionFields, submissionOperations } from './descriptions/SubmissionDescription';
import { templateFieldFields, templateFieldOperations } from './descriptions/TemplateFieldDescription';
import { templateFields, templateOperations } from './descriptions/TemplateDescription';
import {
	PAGE_SIZE,
	PICKER_MAX_ITEMS,
	ROOT_FOLDER,
	docSpringApiRequest,
	docSpringApiRequestAllItems,
	encodeId,
	errorText,
	folderPath,
	schemaToResourceMapperFields,
	signerFieldNames,
} from './GenericFunctions';
import { OPERATIONS } from './operations';

const RESOURCES = [
	{ name: 'Combined PDF', value: 'combinedPdf' },
	{ name: 'Folder', value: 'folder' },
	{ name: 'Signature Request', value: 'signatureRequest' },
	{ name: 'Submission', value: 'submission' },
	{ name: 'Submission Batch', value: 'submissionBatch' },
	{ name: 'Template', value: 'template' },
	{ name: 'Template Field', value: 'templateField' },
];

const OPERATION_DESCRIPTIONS: INodeProperties[] = [
	...combinedPdfOperations,
	...folderOperations,
	...signatureRequestOperations,
	...submissionOperations,
	...submissionBatchOperations,
	...templateOperations,
	...templateFieldOperations,
];

// The canvas subtitle shows each operation's action ("Generate a PDF"), not its stored values.
function subtitleExpression(): string {
	const labels: { [key: string]: string } = {};
	for (const property of OPERATION_DESCRIPTIONS) {
		const resource = property.displayOptions?.show?.resource?.[0] as string;
		for (const option of (property.options || []) as INodePropertyOptions[]) {
			labels[`${resource}:${option.value}`] = option.action || option.name;
		}
	}
	return `={{ (${JSON.stringify(labels)})[$parameter["resource"] + ":" + $parameter["operation"]] || $parameter["operation"] }}`;
}

function templateIdFromParameters(context: ILoadOptionsFunctions): string {
	const value = context.getNodeParameter('templateId', '', { extractValue: true }) as unknown;
	return value === undefined || value === null ? '' : String(value).trim();
}

function templateVersionQuery(context: ILoadOptionsFunctions): IDataObject {
	const version = context.getNodeParameter('templateVersion', '') as unknown;
	const text = version === undefined || version === null ? '' : String(version).trim();
	return text ? { version: text } : {};
}

async function templateSchema(context: ILoadOptionsFunctions): Promise<IDataObject | undefined> {
	const templateId = templateIdFromParameters(context);
	if (!templateId) return undefined;
	return (await docSpringApiRequest.call(context, {
		method: 'GET',
		path: `/templates/${encodeId(templateId, 'Template ID', context.getNode())}/schema`,
		qs: templateVersionQuery(context),
	})) as IDataObject;
}

async function folderOptions(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const folders = await docSpringApiRequestAllItems.call(context, { method: 'GET', path: '/folders' }, PICKER_MAX_ITEMS);
	return folders
		.map((folder) => ({ name: folderPath(folder), value: folder.id as string }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export class DocSpring implements INodeType {
	// The subtitle is built from the operation definitions (see subtitleExpression), which this rule can't read.
	// eslint-disable-next-line n8n-nodes-base/node-class-description-missing-subtitle
	description: INodeTypeDescription = {
		displayName: 'DocSpring',
		name: 'docSpring',
		icon: { light: 'file:docspring.svg', dark: 'file:docspring.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: subtitleExpression(),
		description: 'Generate, combine and sign PDFs, and manage templates, with DocSpring',
		defaults: { name: 'DocSpring' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'docSpringApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: RESOURCES,
				default: 'submission',
			},
			...OPERATION_DESCRIPTIONS,
			...combinedPdfFields,
			...folderFields,
			...signatureRequestFields,
			...submissionFields,
			...submissionBatchFields,
			...templateFields,
			...templateFieldFields,
		],
	};

	methods = {
		listSearch: {
			// The template picker: one page of templates (searched by name) per call, paged by cursor.
			async searchTemplates(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = { limit: PAGE_SIZE };
				if (filter) qs.query = filter;
				if (paginationToken) qs.cursor = paginationToken;
				const page = (await docSpringApiRequest.call(this, { method: 'GET', path: '/templates', qs })) as IDataObject;
				const templates = Array.isArray(page?.data) ? (page.data as IDataObject[]) : [];
				return {
					results: templates.map((template) => ({
						name: (template.name as string) || (template.id as string),
						value: template.id as string,
					})),
					paginationToken: (page?.next_cursor as string) || undefined,
				};
			},
		},
		loadOptions: {
			async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return folderOptions(this);
			},
			async getFoldersWithRoot(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return [{ name: '/ (Root)', value: ROOT_FOLDER }, ...(await folderOptions(this))];
			},
			// The names of the template's fields at the chosen version (the latest when none is chosen), for each
			// signer's fields.
			async getTemplateFieldNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const templateId = templateIdFromParameters(this);
				if (!templateId) return [];
				const response = (await docSpringApiRequest.call(this, {
					method: 'GET',
					path: `/templates/${encodeId(templateId, 'Template ID', this.getNode())}/fields`,
					qs: { version: 'latest', ...templateVersionQuery(this) },
				})) as IDataObject;
				return signerFieldNames(response?.fields).map((name) => ({ name, value: name }));
			},
			// The draft's fields, for Remove Template Fields.
			async getTemplateFieldIds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const templateId = templateIdFromParameters(this);
				if (!templateId) return [];
				const response = (await docSpringApiRequest.call(this, {
					method: 'GET',
					path: `/templates/${encodeId(templateId, 'Template ID', this.getNode())}/fields`,
				})) as IDataObject;
				const fields = Array.isArray(response?.fields) ? (response.fields as IDataObject[]) : [];
				return fields.map((field) => ({
					name: `${field.name ?? '(no name)'} (ID ${field.id}, page ${field.page})`,
					value: field.id as number,
				}));
			},
		},
		resourceMapping: {
			async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const schema = await templateSchema(this);
				return { fields: schemaToResourceMapperFields(schema, false) as unknown as ResourceMapperFields['fields'] };
			},
			async getTemplateFieldsOptional(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const schema = await templateSchema(this);
				return { fields: schemaToResourceMapperFields(schema, true) as unknown as ResourceMapperFields['fields'] };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const run = OPERATIONS[`${resource}:${operation}`];

		for (let i = 0; i < items.length; i++) {
			try {
				if (!run) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" isn't supported for the resource "${resource}"`,
						{ itemIndex: i },
					);
				}
				const responseData = await run.call(this, i);
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: errorText(error) }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) throw error;
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
