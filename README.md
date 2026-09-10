# @docspring/n8n-nodes-docspring

This is an [n8n](https://n8n.io) community node. It lets you use
[DocSpring](https://docspring.com) in your n8n workflows.

DocSpring turns structured data into filled, downloadable, and **signable** PDFs.
Generate PDFs from your templates, merge documents, request data or signatures
from other people, and react to DocSpring events as they happen.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
and install `@docspring/n8n-nodes-docspring`.

> **Status:** published to npm as
> [`@docspring/n8n-nodes-docspring`](https://www.npmjs.com/package/@docspring/n8n-nodes-docspring).
> Pending submission to n8n's verified-community-node program.

## Credentials

You need a DocSpring **API token** (a Token ID and Token Secret). In the DocSpring
web app, open **Settings → API Tokens**, create a token, and copy both values.
When you add the credential in n8n, choose your **Region** (United States, Europe,
Australia, or Self-hosted / Enterprise) and paste the Token ID and Secret.
Credentials are sent as HTTP Basic authentication over HTTPS.

## Operations

- **Submission**
  - **Generate PDF** — fill a template's fields and generate a finished PDF.
  - **Get** — fetch a submission by ID.
  - **Get Many** — list recent submissions, filtered by mode and date.
- **Combined Submission**
  - **Combine PDFs** — merge submissions, templates, or files into one PDF.
- **Template**
  - **Search** — find templates by name or ID.
- **Data Request**
  - **Create** — create a submission that waits for people to fill/sign it, and
    get an authenticated signing link for each recipient.
  - **Create Signing Link** — mint an authenticated link for a data request.

### Trigger

- **DocSpring Trigger (Watch Events)** — start a workflow when a DocSpring event
  occurs (submission processed/failed/created/expired, data request
  completed/viewed, combined submission processed/failed, submission batch
  processed/failed, template created/updated/deleted).

## Resources

- [DocSpring documentation](https://docspring.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
