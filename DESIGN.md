# DocSpring n8n node: design notes

How the DocSpring n8n community node (`@docspring/n8n-nodes-docspring`) is built, and why. Users' docs are in
`README.md`; changes by version in `CHANGELOG.md`. The node calls DocSpring API v2 only. The v2 contract (paths,
parameters, bodies, responses) is the API v2 OpenAPI spec in the DocSpring repo (`openapi/v2/openapi.json`), and the
same operation set and behaviour are shared with the Zapier, Make, Node-RED, Pipedream and Bubble integrations
(Shortcut story sc-5981).

## Package shape

An npm package (n8n finds community packages by the `n8n-community-node-package` keyword). TypeScript compiles to
`dist/`; the `n8n` field in `package.json` points at the built credential and nodes. Icons are copied to `dist/` by
`gulp build:icons`.

```
credentials/DocSpringApi.credentials.ts      # region, token, Basic auth + User-Agent, connection test
nodes/DocSpring/DocSpring.node.ts            # the action node: description, pickers, execute loop
nodes/DocSpring/DocSpringTrigger.node.ts     # webhook trigger
nodes/DocSpring/operations.ts                # one function per resource:operation (builds and sends the request)
nodes/DocSpring/GenericFunctions.ts          # hosts, the request helper, errors, paging, input conversion, schemas
nodes/DocSpring/descriptions/*.ts            # parameters per resource (SharedDescription.ts for shared ones)
nodes/DocSpring/version.ts                   # package version (User-Agent) and the API v1 fallback message
test/*.test.js                               # node --test against dist/, with a mock n8n context
```

The node is programmatic (`execute()`), not declarative: the region and sync-host switching, signing links after a
signature request, failure-state checks and cursor paging are simpler as code.

## Versions

The node's `version` is 1. Version 1.0.0 of the package replaced the API v1 node in place, without a
`VersionedNodeType`, because nobody had saved workflows with 0.1.x. A later change that breaks saved workflows needs
a new node version (n8n keeps each saved node's `typeVersion`).

## Credential: `docSpringApi`

- Properties: `region` (`us`, `eu`, `self_hosted`), `customHost` (self-hosted only), `tokenId`, `tokenSecret`.
- `authenticate` (generic): HTTP Basic with the token ID and secret, and `User-Agent: docspring-n8n/<version>`. n8n
  applies it to every request made with the credential, including from the HTTP Request node ("Predefined Credential
  Type"), which is how users make API calls this node doesn't have. DocSpring's API logs count users by User-Agent.
- `test`: `GET /api/v2/authentication` (`{"authenticated": true}`). A 404 means a self-hosted server without API v2,
  and the test says so (upgrade, or use 0.1.4).

## Requests

`docSpringApiRequest()` in `GenericFunctions.ts` sends every request:

- **Hosts.** US `api.docspring.com`, EU `api-eu.docspring.com`; operations that make a file (Generate PDF, batch
  Create, Combine PDFs, template Create and Replace PDF, Generate Files) use the sync hosts
  (`sync.api.docspring.com`, `sync.api-eu.docspring.com`) with `?wait=true`, or `wait=false` when the user turns
  waiting off. Self-hosted uses its custom host for both (`https://` added when there's no scheme). Path prefix
  `/api/v2`.
- **IDs in paths** are encoded with `encodeURIComponent` (`encodeId`). An ID of `.` or `..` (after trimming) fails
  before any request, since the URL would resolve it to another path.
- **Bodies** are flat JSON with only the properties the operation has (v2 rejects unknown ones). `version` and `wait`
  are query parameters. `test` is only sent when it's true (v2 rejects `test: false` from a test token). Booleans and
  integers that arrive as strings from expressions are converted, or rejected with a message. Optional values left
  empty are left out. Template data from the resource mapper is sent as the user mapped it, minus empty values.
- **Errors.** Requests use `ignoreHttpStatusErrors`, so the helper sees the response and throws a `NodeApiError`:
  `DocSpring API error <status> <code>: <message>` as the message; one line per detail (`<pointer or parameter>:
  <message>`), the record ID (`Submission: sub_…`, or the batch, combined PDF or template) and `Request ID: req_…`
  as the description. A `polling_timeout` says how to get the record later. continueOnFail outputs both parts.
- **Failure states.** A create that returns a record in a failure state (a submission's `error`, `syntax_error`,
  `image_download_failed` or `image_processing_failed`; a combined PDF's or batch's `error`; a template PDF's
  `password_required`, `malformed_pdf`, `unknown_error` or `download_failed`; a generated file's `error`) fails with
  the state, `error_message` and the record ID.
- **Lists** page with `limit` (up to 100) and `cursor` until Limit or every item (Return All). Pickers stop at 1,000.
- **Rate limits.** A 429 means the request wasn't processed (test API tokens make 5 requests a minute, with bursts of
  15), so the helper waits for `Retry-After` (seconds, rounded up, at least 1; 1 when it's missing) with n8n's `sleep`
  and sends the same request again, up to 3 times while each wait is 60 seconds or less (`rateLimitRetry`). Then the
  429 is the usual API error, so a signing link that still fails names the submission that was created.

## Operations

| Resource | Operation | API v2 |
| --- | --- | --- |
| Submission | Generate PDF | `POST /templates/{id}/submissions` (sync) |
| | Check Data | `POST /templates/{id}/submissions/validate` (returns `valid` and the error; doesn't throw) |
| | Get / Get Many | `GET /submissions/{id}` / `GET /submissions` (`template_id`, `test`, `created_after/before`, `include_data`) |
| | Generate Files | `POST /submissions/{id}/generate_files` (sync) |
| | Expire | `DELETE /submissions/{id}` |
| Submission Batch | Create / Get | `POST /submissions/batches` (sync) / `GET /submissions/batches/{id}` |
| Combined PDF | Combine PDFs / Get | `POST /combined_pdfs` (sync) / `GET /combined_pdfs/{id}` |
| Signature Request | Create | `POST /templates/{id}/submissions` with `signature_requests` (standard host), then `POST /signature_requests/{id}/tokens` per signer |
| | Create Signing Link / Get | `POST /signature_requests/{id}/tokens` (`type` in the body) / `GET /signature_requests/{id}` |
| Template | Create | `POST /templates` (sync; `document_url`, or `document_base64` + `filename` from a binary field, up to 7 MB) |
| | Get / Get Many | `GET /templates/{id}` / `GET /templates` (`query`, `parent_folder_id`) |
| | Replace PDF | `PUT /templates/{id}/document` (sync) |
| | Copy / Move / Publish Version | `POST /templates/{id}/copy`, `/move`, `/publish_version` |
| | Get Page Images | `GET /templates/{id}/page_images` |
| Template Field | Get Many / Add / Update / Remove | `GET`, `POST`, `PUT /templates/{id}/fields`, `POST /templates/{id}/fields/remove` |
| Folder | Get Many / Create | `GET /folders` / `POST /folders` |

Responses are the API v2 resources as returned. Get Many operations output one item per resource (Template Field Get
Many: one per field). Create Signature Request adds `signing_url` to each signature request, plus
`first_signature_request_id` and `first_signing_url`; if a link can't be created, the error names the submission
that was created so the user doesn't create it twice.

### Parameters and pickers

- **Template**: a resource locator. "From List" uses `listSearch.searchTemplates` (`GET /templates?query=`, one page
  of 100 per call, `next_cursor` as n8n's pagination token); "By ID" takes `tpl_…`.
- **Template Version**: a query parameter. Operations that create or check a submission default to the latest
  published version; Get Template, Get Page Images and Template Field Get Many default to the draft.
- **Template Data**: a resource mapper built from `GET /templates/{id}/schema?version=` (`schemaToResourceMapperFields`).
  JSON Schema types map to n8n types (number, options for enums, object and array as JSON, `date-time` as
  dateTime). Booleans (checkbox fields) are options too: Leave Blank (`""`), True (`true`) and False (`false`), with no
  default. n8n's mapper gives a `boolean` field a default of `false` when it adds all fields
  (`getDefaultFieldValue` in `ResourceMapper.vue`), and v2 treats `false` as a prefilled value, so a signer's
  checkbox would be a 422; an `options` field gets `null`, which n8n drops. Blank values aren't sent. `format: date`
  fields are text whose label says `YYYY-MM-DD`, because a dateTime value would be sent as a date-time, which v2
  rejects. Create Signature Request and Check Data make every field optional.
- **Signers' fields**: a multi-select of the names from `GET /templates/{id}/fields?version=` (the chosen version, or
  `latest` when it's empty), each once and in the API's order, without static fields, combined fields and `@@`
  submission details (`signerFieldNames`, as in the Pipedream integration). It reloads when the template or version
  changes. v2 requires at least one per signer.
- **Folders**: `loadOptions` pickers over `GET /folders` (paths such as `/Contracts/Leases`). Move and Copy add
  "/ (Root)" (stored as `root`, sent as `parent_folder_id: null`).
- **Date filters**: n8n's date picker gives a time without an offset, read in the workflow's time zone and sent as
  RFC 3339 (`toRfc3339`).

## Trigger: `DocSpringTrigger`

- **Events**: every version 4 event except `webhook.*` (submission, signature request, combined PDF, submission
  batch, template, custom file and folder events). Options: live and/or test, template IDs, include submission data.
- **create**: `POST /api/v2/webhooks` with `url`, `event_types`, `include_submission_data`, `name` (`n8n: <workflow>`)
  and, when set, `mode` and `template_ids`. Only `submission.*`, `signature_request.*` and `template.*` events can
  be filtered by template (the API rejects a template-scoped webhook with any other event), so with template IDs set,
  create fails before calling the API and names the other events. No `version`: webhooks created with API v2 are
  version 4. The webhook's `id` and `secret` are stored in the node's static data (`webhookId`, `webhookSecret`).
- **checkExists**: `GET /api/v2/webhooks/{id}`; true only if it exists and points at this trigger's URL, and then it
  stores the webhook's `secret` (unless it's a version 1 or 2 webhook, which sends unsigned deliveries). That gives a
  webhook stored without a secret its secret on the next activation. A 404 forgets the stored ID and secret.
- **delete**: `DELETE /api/v2/webhooks/{id}`; a 404 counts as deleted, other errors fail. Forgets the ID and secret.
- **Signatures**: with a stored secret, `webhook()` checks `X-DocSpring-Signature` (`t=<time>,v1=<hex>`, any number of
  `v1`): HMAC-SHA256 of `"<t>.<raw body>"` with the secret, in hex, compared in constant time with each `v1`
  (`verifyWebhookSignature`, Node's `crypto`). The raw body is the request's `rawBody` Buffer, which n8n fills
  before parsing the JSON (`readRawBody()` when it hasn't yet; both are declared on `IncomingMessage` in
  n8n-workflow); it is never the re-serialised JSON. A delivery that fails, or has no raw body, gets a 401 through
  `getResponseObject()` and `noWebhookResponse`, and starts nothing. The timestamp's age isn't checked. A webhook
  stored without a secret isn't checked. `crypto` is Node's own module, so the package still has no runtime
  dependencies; `@types/node` is a dev dependency, for its types only.
- **webhook()**: outputs the delivery as received (`id` = event ID, `event_type`, `created_at`, `data` = the API v2
  resource) plus `resource_type` (the event name before the first dot) and `resource_id` (`data.id`).

## Naming

Signature requests (never "data requests"), combined PDFs (never "combined submissions") and IDs (never "UIDs"), in
labels, values and output. The PDF password option is labelled "Encrypt PDF With Passphrase" (n8n's linter reserves
"password" for secrets).

## Checks

- `npm run build`, `npm run lint` (eslint-plugin-n8n-nodes-base, with two rules off that contradict n8n's
  community scanner; see `.eslintrc.js`), `npm test` (builds, then `node --test` against `dist/`; HTTP is mocked and
  the network is blocked).
- `npx @n8n/scan-community-package @docspring/n8n-nodes-docspring` checks a published version against n8n's
  community node rules (it downloads the package from npm).
- Live checks against DocSpring with a test API token: link the built package into a local n8n
  (`~/.n8n/custom`, `N8N_CUSTOM_EXTENSIONS`, or a Docker n8n with the package mounted) and run each operation and
  the trigger.

## Publishing and verification

- `.github/workflows/publish.yml` publishes to npm with provenance on a `v*.*.*` tag (npm trusted publishing from
  GitHub Actions; n8n requires provenance for verified nodes, and the repo must be public).
- n8n verified the node at 0.1.2. Each new version is submitted in n8n's Creator Portal (creators.n8n.io/nodes)
  before n8n Cloud offers it.
