# Changelog

## 1.0.0 (unreleased)

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
