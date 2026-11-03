# Changelog

## 1.1.0 (unreleased)

Needs a DocSpring release that emails signers: older releases refuse `send_email`, so Signature Request → Create, and
Check Data with signers, would fail on them. Self-hosted (Enterprise) installs need that release too; until then, keep
using 1.0.0.

- **Emails to Signers** on Signature Request → Create: DocSpring emails each signer a link to sign (the default, as in
  the API), with any reminders and the signed PDF once everyone has signed; or you send the links yourself. With
  DocSpring's emails you can set the subject, a message, CC addresses, reminders, the reply-to address, notification
  emails and a notification each time someone signs, and the node makes no signing links, so a workflow can't send a
  second one. Sending the links yourself works as before, with the same link types and every authentication type.
- **Signing Order** (everyone at once, or one step at a time) and each signer's **Signing Step**, either way.
- **Check Data** checks the same settings with its signers.
- **Trigger:** the `signature_request.sent` (DocSpring first emailed someone their link) and
  `signature_request.email_bounced` events.
- **Word templates:** Output Formats on Generate PDF and Submission Batch → Create offers a Word template's Word
  document and OpenDocument file (`files.docx`, `files.odt`), and Generate Files can add them, or a PDF, to a Word
  template's processed submission.
- The template picker leaves out a search of only spaces, which API v2 refuses.
- CC and Notification Emails send each address once (the API refuses a list with repeats).
- **Options:** Template Version is in each operation's Options; Template → Create's SCSS, Header HTML and Footer
  HTML and Publish Version's Description are in their Options; Submission → Get Many's template is a filter. n8n's
  review of community nodes asks for optional inputs there.
- Template → Create shows Filename only for a PDF template (an HTML template has no PDF to name).
- The node's subtitle on the canvas is its operation and resource (such as `generatePdf: submission`), as n8n's
  review asks.

## 1.0.0

- **DocSpring API v2.** Every operation calls [API v2](https://docspring.com/docs/api-guide/migrating-to-api-v2/),
  and the trigger creates version 4 webhooks. Outputs are API v2 resources: a submission's PDF link is
  `files.pdf.download_url`, `data_errors` replaces `json_schema_errors`, and so on.
- **Self-hosted DocSpring** needs a release with API v2. Until you upgrade, keep using version 0.1.4 (the credential
  test says so when the server doesn't have API v2).
- **Renames.** Data requests are signature requests and combined submissions are combined PDFs everywhere: the
  **Signature Request** and **Combined PDF** resources, the Combine PDFs source type **Combined PDF**, and the
  trigger's `signature_request.*` and `combined_pdf.*` events. Signature Request → Create outputs
  `signature_requests`, each with its `signing_url`, and `first_signature_request_id` and `first_signing_url`.
- **Signature requests:** each signer needs the fields they fill in (chosen from the template's fields). New:
  role, LDAP and SAML authentication, the OAuth provider, editable prefilled values, ignoring unknown fields, and a
  choice of signing link: email (7 days), API (24 hours) or none.
- **New operations:**
  - Submission: Check Data, Generate Files (PNG page images), Expire; Generate PDF can also make PNG page images and
    take field overrides.
  - Submission Batch: Create (up to 50 PDFs), Get.
  - Combined PDF: Get.
  - Signature Request: Get.
  - Template: Create (from a binary file or URL, with AI field detection, or HTML), Get, Replace PDF, Copy, Move,
    Publish Version, Get Page Images. Search is now Get Many, with a folder filter.
  - Template Field: Get Many, Add, Update, Remove.
  - Folder: Get Many, Create.
- **Trigger:** every API v2 event except webhook events, including `submission.declined`, `submission.updated`,
  `signature_request.declined`, `signature_request.updated`, `combined_pdf.expired`, `custom_file.created` and the
  folder events. Optional template filter (for submission, signature request and template events), and submission
  data can be left out. Each delivery's signature is checked with the webhook's secret, and one that doesn't match
  gets a 401 and starts nothing. Each event is output as delivered
  (`id`, `event_type`, `created_at`, `data`) with `resource_type` and `resource_id`.
- **Make an API call:** the DocSpring credential works in n8n's HTTP Request node (Predefined Credential Type).
- Error messages show DocSpring's error code and message, each problem's field, the record's ID and the request ID.
  A PDF that fails to generate is an error with its reason. Test is only sent when it's on, so test API tokens work.
- The template picker searches by name and pages through every template.
- Checkbox fields in Template Data are Leave Blank, True or False, and start blank, so they're only sent when you set
  them.
- IDs are encoded in request URLs, and an ID of `.` or `..` is rejected before any request.
- A rate-limited request (429) is sent again after its Retry-After, up to 3 times when each wait is 60 seconds or less.

## 0.1.4 (2026-10-14)

- Read the webhook's `id` from the DocSpring API, not `uid`.

## 0.1.3 (2026-09-20)

- Removed the Australia region.

## 0.1.2 (2026-09-10)

- Passed n8n's community node checks; first verified release.

## 0.1.1 (2026-09-10)

- Published from GitHub Actions with npm provenance.

## 0.1.0 (2026-09-10)

- First release: Generate PDF, Get and Get Many submissions, Combine PDFs, Search templates, Create Signature Request,
  Create Signing Link, and a trigger for 13 webhook events (API v1).
