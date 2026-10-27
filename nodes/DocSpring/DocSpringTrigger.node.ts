import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	PICKER_MAX_ITEMS,
	docSpringApiRequest,
	docSpringApiRequestAllItems,
	encodeId,
	flattenDelivery,
	parseList,
} from './GenericFunctions';

// Every version 4 webhook event except webhook.* (API v2's names).
export const EVENTS = [
	{ name: 'Combined PDF Expired', value: 'combined_pdf.expired' },
	{ name: 'Combined PDF Failed', value: 'combined_pdf.failed' },
	{ name: 'Combined PDF Processed', value: 'combined_pdf.processed' },
	{ name: 'Custom File Created', value: 'custom_file.created' },
	{ name: 'Folder Created', value: 'folder.created' },
	{ name: 'Folder Deleted', value: 'folder.deleted' },
	{ name: 'Folder Updated', value: 'folder.updated' },
	{ name: 'Signature Request Completed', value: 'signature_request.completed' },
	{ name: 'Signature Request Declined', value: 'signature_request.declined' },
	{ name: 'Signature Request Updated', value: 'signature_request.updated' },
	{ name: 'Signature Request Viewed', value: 'signature_request.viewed' },
	{ name: 'Submission Batch Failed', value: 'submission_batch.failed' },
	{ name: 'Submission Batch Processed', value: 'submission_batch.processed' },
	{ name: 'Submission Created', value: 'submission.created' },
	{ name: 'Submission Declined', value: 'submission.declined' },
	{ name: 'Submission Expired', value: 'submission.expired' },
	{ name: 'Submission Failed', value: 'submission.failed' },
	{ name: 'Submission Processed', value: 'submission.processed' },
	{ name: 'Submission Updated', value: 'submission.updated' },
	{ name: 'Template Created', value: 'template.created' },
	{ name: 'Template Deleted', value: 'template.deleted' },
	{ name: 'Template Updated', value: 'template.updated' },
];

function isNotFound(error: unknown): boolean {
	const httpCode = (error as { httpCode?: string | number | null })?.httpCode;
	return String(httpCode) === '404';
}

export class DocSpringTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DocSpring Trigger',
		name: 'docSpringTrigger',
		icon: { light: 'file:docspring.svg', dark: 'file:docspring.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow when a DocSpring event occurs',
		defaults: { name: 'DocSpring Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'docSpringApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The DocSpring events to start the workflow on',
				options: EVENTS,
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{ name: 'Live and Test', value: 'all' },
					{ name: 'Live Only', value: 'live' },
					{ name: 'Test Only', value: 'test' },
				],
				default: 'all',
				description: 'Whether to receive events for live submissions, test submissions, or both',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Submission Data',
						name: 'includeSubmissionData',
						type: 'boolean',
						default: true,
						description:
							"Whether events include the submission's data. Turned off, the data and each signature request's data, IP address and user agent are null.",
					},
					{
						displayName: 'Template Names or IDs',
						name: 'templateIds',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getTemplates' },
						default: [],
						description:
							'Only receive submission, signature request and template events for these templates. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const templates = await docSpringApiRequestAllItems.call(
					this,
					{ method: 'GET', path: '/templates' },
					PICKER_MAX_ITEMS,
				);
				return templates
					.map((template) => ({ name: (template.name as string) || (template.id as string), value: template.id as string }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	webhookMethods = {
		default: {
			// The stored webhook still exists and points at this trigger's URL.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.webhookId) return false;
				try {
					const webhook = (await docSpringApiRequest.call(this, {
						method: 'GET',
						path: `/webhooks/${encodeId(String(webhookData.webhookId), 'Webhook ID', this.getNode())}`,
					})) as IDataObject;
					return webhook.url === this.getNodeWebhookUrl('default');
				} catch (error) {
					if (!isNotFound(error)) throw error;
					delete webhookData.webhookId;
					return false;
				}
			},

			// Creates a version 4 webhook with API v2 and stores only its ID.
			async create(this: IHookFunctions): Promise<boolean> {
				const options = (this.getNodeParameter('options', {}) as IDataObject) || {};
				const body: IDataObject = {
					url: this.getNodeWebhookUrl('default'),
					event_types: this.getNodeParameter('events') as string[],
					include_submission_data: String(options.includeSubmissionData ?? true).trim().toLowerCase() !== 'false',
				};
				const workflowName = this.getWorkflow().name;
				body.name = workflowName ? `n8n: ${workflowName}`.slice(0, 255) : 'n8n';
				const mode = this.getNodeParameter('mode', 'all') as string;
				if (mode === 'live' || mode === 'test') body.mode = mode;
				const templateIds = parseList(options.templateIds);
				if (templateIds.length) body.template_ids = templateIds;

				const webhook = (await docSpringApiRequest.call(this, { method: 'POST', path: '/webhooks', body })) as IDataObject;
				if (!webhook?.id) return false;
				const webhookData = this.getWorkflowStaticData('node');
				webhookData.webhookId = webhook.id as string;
				return true;
			},

			// Deletes the webhook. A 404 means it's already gone.
			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (webhookData.webhookId) {
					try {
						await docSpringApiRequest.call(this, {
							method: 'DELETE',
							path: `/webhooks/${encodeId(String(webhookData.webhookId), 'Webhook ID', this.getNode())}`,
						});
					} catch (error) {
						if (!isNotFound(error)) throw error;
					}
					delete webhookData.webhookId;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		return {
			workflowData: [this.helpers.returnJsonArray([flattenDelivery(body)])],
		};
	}
}
