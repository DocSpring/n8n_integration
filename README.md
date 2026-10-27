# @docspring/n8n-nodes-docspring

This is an [n8n](https://n8n.io) community node. It lets you use [DocSpring](https://docspring.com) in your n8n
workflows.

DocSpring fills in, generates and e-signs PDFs. With this node you can generate PDFs from your templates (one at a
time or in batches), combine PDFs, send documents out for signature, create and manage templates, and start
workflows when something happens in DocSpring. It uses
[DocSpring API v2](https://docspring.com/docs/api-guide/migrating-to-api-v2/).

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) ·
[Trigger](#trigger) · [Make an API call](#make-an-api-call) · [Resources](#resources)

## Installation

DocSpring is a verified community node. In n8n Cloud or on your own server, an instance owner or admin can install it
from the nodes panel: search for **DocSpring** and select it under **More from the community**. You can also follow
the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install
[`@docspring/n8n-nodes-docspring`](https://www.npmjs.com/package/@docspring/n8n-nodes-docspring) from npm.

## Credentials

You need a DocSpring **API token** (a token ID and secret). In DocSpring, open **Settings → API Tokens**, create a
token, and copy both values. When you add the credential in n8n, choose your **Region** (United States, Europe, or
Self-Hosted / Enterprise) and paste the token ID and secret. They're sent with HTTP Basic authentication over HTTPS.

A test API token only makes free test PDFs (with a watermark), so you can build a workflow without using credits.

**Self-hosted DocSpring:** this version needs a DocSpring release with API v2. If the credential test says the server
doesn't have API v2 yet, upgrade DocSpring, or install version 0.1.4 of this node until you can.

## Operations

- **Submission**
  - **Generate PDF**: fill in a template with data and generate a PDF (and PNG page images if you ask for them).
  - **Check Data**: check data, and optionally signers, against a template's fields without generating anything or
    using credits.
  - **Get** a submission, or **Get Many** (by template, live or test, and creation date).
  - **Generate Files**: add PNG page images to a submission that has been processed.
  - **Expire**: delete a submission's data and files now.
- **Submission Batch**
  - **Create**: generate up to 50 PDFs in one request (the submissions are a JSON array).
  - **Get** a batch.
- **Combined PDF**
  - **Combine PDFs**: merge submissions, combined PDFs, templates, custom files and URLs into one PDF.
  - **Get** a combined PDF.
- **Signature Request**
  - **Create**: create a submission that waits for people to fill in and sign it, with a signing link for each signer.
  - **Create Signing Link**: create a new link for a signature request.
  - **Get** a signature request.
- **Template**
  - **Create**: a PDF template from a PDF (an input binary field or an https:// URL), with optional AI field
    detection, or an HTML template.
  - **Get**, **Get Many** (by name and folder), **Get Page Images**.
  - **Replace PDF**: replace a PDF template's PDF, keeping its fields (or reimporting them from the new PDF).
  - **Copy**, **Move** to a folder or the root, **Publish Version**.
- **Template Field**: **Get Many**, **Add**, **Update**, **Remove** (Add and Update take a JSON array of fields).
- **Folder**: **Get Many**, **Create**.

### Template data

Generate PDF, Check Data and Create Signature Request show a field for each of the template's fields, from the
template version you choose (the latest published version by default). Date fields take dates as `YYYY-MM-DD`; their
names show the format. Turn on **Attempt to convert types** in the field list if your values arrive as text (such as
`"42"` for a number field).

### Generating PDFs

Operations that make a file wait until it's ready, then return the record with its files (the PDF's link is
`files.pdf.download_url`). Turn off **Wait for PDF** in the options to get the record straight away, then use **Get**
or the trigger. If DocSpring couldn't generate the PDF, the node fails with the reason and the submission's ID.

### Signature requests

Each signer needs the fields they fill in. Choose them from the template's fields (at the template version you
chose, or the latest), or set them with an expression.
**Authentication** says how your app checked who the person is (Email Link by default); OAuth also needs an **Auth
Provider**, such as `google`. Set **Role** (`Signer 1`, `Signer 2`, …) for every signer or for none.

**Signing Links** creates a link for each signer: an **email link** lasts 7 days and an **API link** 24 hours, and a
form that opened in time keeps working for 7 more days. The output adds `signing_url` to each item in
`signature_requests`, and `first_signature_request_id` and `first_signing_url` for workflows with one signer. Use
**Create Signing Link** when a link has expired.

## Trigger

**DocSpring Trigger** starts a workflow when a DocSpring event happens. Choose any of the events (submissions,
signature requests, combined PDFs, submission batches, templates, custom files and folders), live or test events,
and optionally limit it to some templates. Activating the workflow creates a webhook in DocSpring; deactivating it
deletes the webhook.

Each event is output like this, with `data` as API v2 returns the resource:

```json
{
  "id": "6f1c2e8a-3b4d-4c5e-9f60-7a8b9c0d1e2f",
  "event_type": "submission.processed",
  "created_at": "2026-06-27T03:16:07Z",
  "resource_type": "submission",
  "resource_id": "sub_1234567890abcdef01",
  "data": { "id": "sub_1234567890abcdef01", "state": "processed", "files": { "pdf": { "download_url": "…" } } }
}
```

`id` is the event's ID, which stays the same when DocSpring retries a delivery.

## Make an API call

To call an API v2 endpoint this node doesn't have, use n8n's **HTTP Request** node with your DocSpring credential:

1. Set **Authentication** to **Predefined Credential Type**, **Credential Type** to **DocSpring API**, and choose your
   credential. n8n adds the token and a User-Agent to the request.
2. Set the **URL** to the endpoint on your region's host, such as `https://api.docspring.com/api/v2/custom_files`:

   | Region | Host |
   | --- | --- |
   | United States | `https://api.docspring.com` |
   | Europe | `https://api-eu.docspring.com` |
   | Self-hosted | your DocSpring URL |

   Requests that should wait for a PDF go to `https://sync.api.docspring.com` (`https://sync.api-eu.docspring.com`
   in Europe).
3. Send JSON bodies (**Body Content Type: JSON**).

The [API v2 reference](https://docspring.com/docs/api/) lists every endpoint.

## Resources

- [DocSpring documentation](https://docspring.com/docs)
- [DocSpring API v2 reference](https://docspring.com/docs/api/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE.md)
