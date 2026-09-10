# DocSpring n8n Node — Design Notes

Port spec for the DocSpring **n8n community node** (`n8n-nodes-docspring`).
Companion to `README.md`. Source of truth for behavior is the Zapier integration
(`DocSpring/zapier_integration`) and the Make app (`DocSpring/make_integration`);
this doc records what carries over and what changes because n8n nodes are
**TypeScript** (declarative routing + a few programmatic methods), packaged as an
npm community node.

## Package shape

An npm package named **`n8n-nodes-docspring`** (n8n discovers community packages
by the `n8n-nodes-*` name + the `n8n-community-node-package` keyword). Compiles TS
→ `dist/`; the `n8n` field in package.json points at the built credential + node
files. Icon: `nodes/DocSpring/docspring.png` (copied from the Make app logo),
copied to `dist/` by `gulp build:icons`.

```
credentials/DocSpringApi.credentials.ts
nodes/DocSpring/DocSpring.node.ts           # actions + searches
nodes/DocSpring/DocSpringTrigger.node.ts    # Watch Events (webhook trigger)
nodes/DocSpring/docspring.png
nodes/DocSpring/*.ts                         # shared descriptions/helpers
```

## Credentials — `DocSpringApi`

Mirrors the Zapier custom auth (`lib/regions.js`):
- Properties: `region` (US / EU / AU / Self-hosted), `customHost`, `tokenId`,
  `tokenSecret` (password).
- Auth: HTTP Basic — `Authorization: Basic base64(tokenId:tokenSecret)`, applied
  via the credential's `authenticate` block.
- `test`: `GET /api/v1/authentication` (200 `{status:success}`).
- Region → host (baseURL): US `api.docspring.com`, EU `api-eu.docspring.com`,
  AU `api-au.docspring.com`, self-hosted → `customHost`. **Sync host** for
  Generate PDF / Combine PDFs: `sync.api.docspring.com` (+ region variants);
  self-hosted reuses its single origin.

## Node: `DocSpring` (actions + searches)

Declarative routing where possible; `resourceMapper` for dynamic template fields.
`requestDefaults.baseURL` resolved from the `region` credential.

### Resources & operations

- **Submission**
  - **Generate PDF** — `POST {sync}/api/v1/templates/{templateId}/submissions?wait=true`.
    Template picker via `loadOptions` (list templates); per-template fields via a
    `resourceMapper` (schema from `GET /templates/{id}/schema`). Body: `data`
    (from mapped fields), `test`, `metadata`, `password` (from a **PDF passphrase**
    field — never keyed "password" in the UI), `editable`, `expires_in`, `version`.
    Returns `body.submission`.
  - **Get** — `GET /api/v1/submissions/{id}` (single).
  - **Get Many** — `GET /api/v1/submissions?limit=…&type=…&created_after/before` →
    `body.submissions`.
- **Combined Submission**
  - **Combine PDFs** — `POST {sync}/api/v1/combined_submissions?wait=true`.
    `source_pdfs` fixedCollection (`type` submission|template|custom_file, `id`,
    optional `template_version`), `metadata`, `password`, `expires_in`. Returns
    `body.combined_submission`.
- **Template**
  - **Get Many / Search** — `GET /api/v1/templates?query=…&per_page=…` (bare array).
- **Data Request**
  - **Create** — `POST /api/v1/templates/{templateId}/submissions` (standard host,
    **no wait**). `data` (optional pre-fill via resourceMapper, all optional),
    `data_requests` (recipients: email, name, fields[], auth_type default
    `email_link`), plus control fields. Then, programmatically, mint a 30-day
    `email` token per recipient (`POST /data_requests/{id}/tokens {type:email}`)
    and attach `signing_url` (+ `first_signing_url`). Returns the submission
    (`waiting_for_data_requests`) enriched with signing links.
  - **Create Signing Link** — `POST /api/v1/data_requests/{id}/tokens` (`type`
    email|api). Returns the token + `data_request_url`.

### Dynamic data (n8n equivalents of Make RPCs / Zapier dynamic fields)

- `loadOptions.getTemplates` → template dropdown (`GET /templates?per_page=100`).
- `resourceMapping.getTemplateFields` → `GET /templates/{id}/schema` → columns.
  JSON-Schema (draft-04) → n8n field types (mirror `lib/templates.js`):
  integer→number, number→number, boolean→boolean, string→string
  (date-time/date→dateTime), `enum`→options; nested object / array-of-object →
  a JSON field (documented v1 limitation); array-of-scalar → string list.
  Optional variant (all non-required) for Create Data Request.

## Node: `DocSpringTrigger` (Watch Events)

A webhook trigger node with REST-hook `webhookMethods` (mirror `lib/hooks.js`):
- **create** → `POST /api/v1/webhooks` with `{ webhook: { url:<n8n webhook url>,
  event_types:[…selected…], include_submission_data:true, version:3, name:"n8n",
  mode, template_uids, folder_uids } }`; store `uid` in `workflowStaticData`.
- **checkExists** → optional `GET /webhooks/{uid}`.
- **delete** → `DELETE /api/v1/webhooks/{uid}`; tolerate 404.
- **webhook()** → return the delivery flattened: top-level `id` stays the **event**
  id (stable across retries), resource id exposed as `resource_id` (parity with
  `lib/payload.js`). One node, an `events` multiSelect (all 13 events) + a `mode`
  filter — the idiomatic n8n pattern (cf. one trigger node, not 13).

Events: `submission.processed` / `.failed` / `.created` / `.expired`,
`submission_data_request.completed` / `.viewed`,
`combined_submission.processed` / `.failed`,
`submission_batch.processed` / `.failed`,
`template.created` / `.updated` / `.deleted`.

## Gotchas carried over

- `version:3` pinned on webhook subscribe; flatten keeps event id as top-level id.
- **Sync host + `?wait=true`** for Generate PDF / Combine PDFs; **standard host,
  no wait** for Create Data Request.
- The PDF-encryption field is surfaced as "Encrypt PDF With Passphrase" and mapped
  to the API's `password` (never label a non-auth field "password").
- Self-hosted `customHost` validation (only `[scheme://]host[:port]`).
- Combine PDFs / Data Request errors: DocSpring returns `{status:error, errors:[…]}`
  — surface `errors.join(', ')` as a clean NodeApiError.

## Testing & publishing

- Local: `npm run build`, link into a local n8n (`~/.n8n/custom` or
  `N8N_CUSTOM_EXTENSIONS`, or a docker n8n with the package mounted); exercise each
  operation against the DocSpring test account (token in a local `.env`, gitignored).
- Publish `n8n-nodes-docspring` to npm, then submit for n8n's **verified community
  node** program.
