import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { docSpringApiRequest, flattenDelivery } from './GenericFunctions';

const EVENTS = [
	{ name: 'Submission Processed', value: 'submission.processed' },
	{ name: 'Submission Failed', value: 'submission.failed' },
	{ name: 'Submission Created', value: 'submission.created' },
	{ name: 'Submission Expired', value: 'submission.expired' },
	{ name: 'Data Request Completed', value: 'submission_data_request.completed' },
	{ name: 'Data Request Viewed', value: 'submission_data_request.viewed' },
	{ name: 'Combined Submission Processed', value: 'combined_submission.processed' },
	{ name: 'Combined Submission Failed', value: 'combined_submission.failed' },
	{ name: 'Submission Batch Processed', value: 'submission_batch.processed' },
	{ name: 'Submission Batch Failed', value: 'submission_batch.failed' },
	{ name: 'Template Created', value: 'template.created' },
	{ name: 'Template Updated', value: 'template.updated' },
	{ name: 'Template Deleted', value: 'template.deleted' },
];

export class DocSpringTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DocSpring Trigger',
		name: 'docSpringTrigger',
		icon: 'file:docspring.png',
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
				description: 'The DocSpring events to subscribe to',
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
				description: 'Whether to receive live events, test events, or both',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.webhookUid) return false;
				try {
					await docSpringApiRequest.call(this, 'GET', `/webhooks/${webhookData.webhookUid}`);
					return true;
				} catch (error) {
					delete webhookData.webhookUid;
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];
				const mode = this.getNodeParameter('mode') as string;

				const webhook: IDataObject = {
					url: webhookUrl,
					event_types: events,
					include_submission_data: true,
					version: 3,
					name: 'n8n',
				};
				if (mode !== 'all') webhook.mode = mode;

				const response = (await docSpringApiRequest.call(this, 'POST', '/webhooks', {
					webhook,
				})) as IDataObject;

				if (!response.uid) return false;
				const webhookData = this.getWorkflowStaticData('node');
				webhookData.webhookUid = response.uid as string;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (webhookData.webhookUid) {
					try {
						await docSpringApiRequest.call(
							this,
							'DELETE',
							`/webhooks/${webhookData.webhookUid}`,
						);
					} catch (error) {
						// A 404 (already deleted) is fine — deactivation must always succeed.
					}
					delete webhookData.webhookUid;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		return {
			workflowData: [this.helpers.returnJsonArray([flattenDelivery(body)])],
		};
	}
}
