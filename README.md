# Early Access metafields API

Saves the answers a logged-in customer gives in the storefront Early Access quiz popup (the five Figma screens: weekly distance and run screenshot, running surfaces, running goal, shoe size, then the "You're on the list" pass). When the shopper presses Continue on question 4, the popup posts every answer once. The API creates a metaobject entry holding all of them (type `early_access_submission`) and sets that entry on the customer's `early_access.submission` metafield. Both names come from environment variables.

## How it works

```
Storefront popup (theme), Continue on question 4
  POST /apps/early-access            multipart form, same origin as the store
        |
        v
Shopify app proxy                    adds shop, logged_in_customer_id, timestamp
        |                            and an HMAC signature made with the app secret
        v
Vercel  POST /api/early-access
  1. verify the signature, the shop and the timestamp
  2. refuse a browser Origin that is not the storefront
  3. refuse logged-out shoppers (logged_in_customer_id is empty)
  4. validate the answers and the screenshot
  5. screenshot -> stagedUploadsCreate -> upload -> fileCreate (Shopify Files)
  6. metaobjectUpsert: entry of type EARLY_ACCESS_METAOBJECT_TYPE,
     handle customer-<id>, with every answer
  7. metafieldsSet: customer EARLY_ACCESS_CUSTOMER_METAFIELD = that entry
        |
        v
JSON back to the popup: pass number, saved answers
```

Why an app proxy: the theme cannot create metaobjects or write customer metafields itself. Liquid customer forms have no metafield fields, and the Storefront API cannot write either. Writing needs the Admin API, and the Admin API token must never reach the browser. The app proxy keeps the call on the store's own domain and tells the API which customer is logged in, signed by Shopify, so the API never trusts a customer ID sent by the browser.

Why upsert: each customer has exactly one entry, found by its handle `customer-<id>`. The first submission creates it; a later one updates it in place, so a customer who retakes the quiz never leaves a stray entry behind. If linking fails after the entry was saved, sending the quiz again finishes the job without a duplicate.

## Setup

### 1. Create the Shopify app

In the Shopify Dev Dashboard of the organization that owns the store, create an app and release a version with:

- Access scopes:

  | Scope | Why |
  | --- | --- |
  | `write_customers` | Set the `EARLY_ACCESS_CUSTOMER_METAFIELD` metafield on the customer |
  | `write_files` | Upload the run screenshot to Shopify Files |
  | `write_metaobjects` | Create and update the Early Access submission entries |
  | `write_metaobject_definitions` | Only for `npm run definitions` in step 3. Can be removed after setup. |

  Each write scope includes its read scope. No other scope is needed.
- Protected customer data: if a submission fails with "This app is not approved to access the Customer object" in the function logs, request protected customer data access for the app in the Dev Dashboard. Level 1 is enough: the API reads no name, email, phone or address.
- App proxy: prefix `apps`, subpath `early-access`, proxy URL `https://<deployment>/api/early-access`

If the app is managed with Shopify CLI, the same settings in `shopify.app.toml` are:

```toml
[access_scopes]
scopes = "write_customers,write_files,write_metaobjects,write_metaobject_definitions"

[app_proxy]
url = "https://<deployment>/api/early-access"
prefix = "apps"
subpath = "early-access"
```

Install the app on the store. Copy the app's Client ID and Client secret.

The API gets Admin API tokens with the client credentials grant, which only works when the app and the store belong to the same Dev Dashboard organization. Tokens last 24 hours and the API requests a new one before expiry.

### 2. Environment variables

Every variable is listed with its purpose in [`.env.example`](.env.example).

```bash
cp .env.example .env.local      # local runs and the definitions script
```

On Vercel:

```bash
vercel link
vercel env add SHOPIFY_STORE_DOMAIN production
vercel env add SHOPIFY_STOREFRONT_ORIGIN production
vercel env add SHOPIFY_API_KEY production
vercel env add SHOPIFY_API_SECRET production
vercel env add EARLY_ACCESS_METAOBJECT_TYPE production
vercel env add EARLY_ACCESS_CUSTOMER_METAFIELD production
vercel --prod
```

Redeploy after changing any variable. Then put the deployment URL into the app proxy setting from step 1.

All six are required. A missing or malformed value makes the write endpoint answer `503` and `/api/test` name the variable.

| Variable | Example | Purpose |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `store-name.myshopify.com` | The store. Proxy requests from any other shop are refused. |
| `SHOPIFY_STOREFRONT_ORIGIN` | `https://www.example.com` | Public storefront origin the popup runs on; a bare host means `https`. Comma-separate several. A request whose browser `Origin` is another site is refused with `403`. `https://<SHOPIFY_STORE_DOMAIN>` is always allowed. |
| `SHOPIFY_API_KEY` | 32 letters and digits | App Client ID, used to request Admin API tokens. Not an `shpat_` or `shpca_` access token. |
| `SHOPIFY_API_SECRET` | `shpss_...` | App Client secret. Verifies the app proxy signature and requests Admin API tokens. Secret. |
| `EARLY_ACCESS_METAOBJECT_TYPE` | `early_access_submission` | Metaobject type that holds the answers. |
| `EARLY_ACCESS_CUSTOMER_METAFIELD` | `early_access.submission` | Customer metafield, as `namespace.key`, that points to the entry. |

`.env.local` and every other `.env.*` file except `.env.example` are git-ignored.

### 3. Create the definitions (once per store, before the first submission)

```bash
npm run definitions
```

Reads `.env.local` and creates, in this order:

1. The metaobject definition named by `EARLY_ACCESS_METAOBJECT_TYPE` (fields in the registry below).
2. The customer metafield definition named by `EARLY_ACCESS_CUSTOMER_METAFIELD`, type `metaobject_reference`, restricted to that metaobject definition and pinned so it shows on the customer page in admin.

Safe to run again: existing definitions are reported and left alone. Without them every submission fails with `502`, because a `metaobject_reference` metafield needs its definition.

### 4. Check the deployment

- `https://<deployment>/` lists every endpoint and the variables it needs.
- `https://<deployment>/api/health` answers `200` when the function runs.
- `https://<deployment>/api/test` answers `200` only when all variables are set and well formed, the Admin API connects, and `write_customers`, `write_files` and `write_metaobjects` are granted. Otherwise `503` with the reason. It does not check that step 3 has run.

## Metaobject and metafield registry

Names below are the values in `.env.example`.

### Metaobject `early_access_submission` (`EARLY_ACCESS_METAOBJECT_TYPE`)

One entry per customer, handle `customer-<customer id>`, display name from `pass_number`. Storefront access is off (see [Reading the answers in Liquid](#reading-the-answers-in-liquid)).

| Key | Type | Required | Content |
| --- | --- | --- | --- |
| `pass_number` | `single_line_text_field` | yes | Pass number for the confirmation card |
| `weekly_distance` | `single_line_text_field` | yes | Question 1 answer handle, for example `10-25-km` |
| `run_screenshot` | `file_reference` (images only) | no | Question 1 screenshot, stored in Shopify Files |
| `surfaces` | `list.single_line_text_field` | yes | Question 2 answer handles, for example `["road","trail"]` |
| `goal` | `single_line_text_field` | yes | Question 3 answer handle, for example `half-marathon` |
| `shoe_fit` | `single_line_text_field` | yes | Question 4 fit handle, for example `mens` |
| `shoe_size` | `single_line_text_field` | yes | Question 4 UK size, for example `9` or `9.5` |
| `submitted_at` | `date_time` | yes | Time of the latest submission |

### Customer metafield `early_access.submission` (`EARLY_ACCESS_CUSTOMER_METAFIELD`)

| Owner | Type | Content |
| --- | --- | --- |
| Customer | `metaobject_reference` to `early_access_submission` | The customer's entry |

The API stores answer handles, not labels. Question text and answer labels belong in the theme, editable by the merchant and translated through locale files, so the API accepts any lowercase handle (letters, digits, hyphens, up to 64 characters) instead of a fixed list. Keep handles stable once customers have answered, because existing entries keep the old handle.

`pass_number` is the customer's numeric ID in base 36, so it is unique, never changes for that customer, and needs no counter. The theme adds any prefix (the design shows `IN-`).

The metaobject type and the metafield namespace and key come from the environment; the field keys are constants in `lib/early-access-store.js`. Change any of them before running step 3, never after customers have submitted: existing entries and links keep the old names and the API would stop finding them.

## Storefront contract

Show the popup only to logged-in customers (`{% if customer %}`) and send everything else to `routes.account_login_url`. Collect the answers across questions 1 to 4 in one `<form>` and send it once, when the shopper presses Continue on question 4.

### Request

`POST /apps/early-access` with the popup's `<form>` as `FormData`:

| Field | Required | Value |
| --- | --- | --- |
| `weekly_distance` | yes | one answer handle |
| `surfaces` | yes | one or more answer handles, one field per checked box |
| `goal` | yes | one answer handle |
| `shoe_fit` | yes | one answer handle |
| `shoe_size` | yes | UK size such as `9` or `9.5` |
| `run_screenshot` | no | PNG or JPG file, up to 2 MB. The content is checked, not only the extension. |

Answer handles for the options in the Figma screens. The API accepts any valid handle, so these are the theme's choice; use them unless there is a reason not to, and keep them stable once customers have answered.

| Question | Field | Option label | Handle |
| --- | --- | --- | --- |
| 1 How far do you run in a week? | `weekly_distance` | Under 10 km | `under-10-km` |
| | | 10-25 km | `10-25-km` |
| | | 25-50 km | `25-50-km` |
| | | 50 km + | `50-km-plus` |
| 2 Which surface do you run on? (pick all) | `surfaces` | Road | `road` |
| | | Trail | `trail` |
| | | Track | `track` |
| | | Treadmill | `treadmill` |
| 3 What are you running towards? | `goal` | Moving every day | `moving-every-day` |
| | | A first 10K | `first-10k` |
| | | A half marathon | `half-marathon` |
| | | A full marathon | `full-marathon` |
| | | An ultra or trail race | `ultra-or-trail-race` |
| 4 What's your shoe size? | `shoe_fit` | Men's | `mens` |
| | | Women's | `womens` |
| | `shoe_size` | 5 to 12 in half sizes | `5`, `5.5` ... `12` |

```js
const response = await fetch('/apps/early-access', {
  method: 'POST',
  body: new FormData(form),
  headers: { Accept: 'application/json' },
});
const result = await response.json().catch(() => null);
```

Wrap the call in `try`/`catch` and show an error state on network failure. Show the pass screen only after a `200`.

### Responses

| Status | Body | Show |
| --- | --- | --- |
| `200` | `{ ok: true, passNumber, submittedAt, answers, screenshotSaved }` | The pass screen |
| `400` | `{ ok: false, code: 'invalid_answers', fields: { goal: 'required' } }` | The error next to each field in `fields` |
| `401` | `{ ok: false, code: 'not_logged_in' }` | The sign-in prompt |
| `401` | `{ ok: false }` without a code | A generic error. The request did not come through the store. |
| `403` | `{ ok: false }` | A generic error. The browser sent an `Origin` that is not in `SHOPIFY_STOREFRONT_ORIGIN`. |
| `413` | `{ ok: false, code: 'too_large' }` | The file-size error |
| `502`, `503` | `{ ok: false }` | A generic "try again" error |

Field error codes are `required`, `invalid`, `unsupported_type` and `too_large`. They are codes, not sentences, so the theme maps each one to a translated string. Do not show the `error` text from the API to shoppers: it is English only and meant for developers.

The pass card takes the pass number and size from the `200` response. The rest comes from the theme: the first name from `customer.first_name`, the phone from `customer.phone`, the opening date from a section setting.

### Reading the answers in Liquid

Off by default. The metaobject definition is created with storefront access `NONE`, so `customer.metafields.early_access.submission.value` is empty in Liquid and the entries are visible only in admin.

Liquid can read a metaobject only when its definition has storefront access, and that same setting lets the Storefront API list every entry of the type with the public storefront token. That would expose every customer's answers, pass number and run screenshot URL to anyone who queries it. Keep it off unless that is acceptable.

If it is, turn on Storefronts access for `Early Access submission` in Settings > Custom data > Metaobjects, then:

```liquid
{%- assign submission = customer.metafields.early_access.submission.value -%}
{%- if submission -%}
  {{ submission.pass_number.value }}
  {{ submission.shoe_size.value }}
  {%- for surface in submission.surfaces.value -%}{{ surface }}{%- endfor -%}
  {{ submission.run_screenshot.value | image_url: width: 400 | image_tag }}
{%- endif -%}
```

## Security

- The only write endpoint accepts requests signed by the Shopify app proxy (HMAC-SHA256 with the app secret, compared in constant time), from the configured shop, at most 5 minutes old.
- A request whose browser `Origin` header is not the storefront (`SHOPIFY_STOREFRONT_ORIGIN` or the myshopify.com origin) is refused, as a guard against other sites posting on a signed-in shopper's behalf. A request with no `Origin` header is allowed, because the app proxy may not forward it.
- The customer comes from the signed `logged_in_customer_id`. The request body cannot choose which customer gets written or which entry gets updated: the entry handle is built from the signed ID. A request that carries the parameter twice is refused.
- The app proxy signature covers the query string, not the body, and has no nonce. A signed URL captured from a log could be replayed with a different body for that same customer within the 5-minute window. Keep query strings out of shared logs.
- Screenshot uploads are limited to PNG and JPG up to 2 MB, checked by file signature.
- Metaobject entries are not readable from the storefront (storefront access `NONE`).
- Errors returned to the browser are short and generic. Shopify responses and stack traces go to the Vercel function logs only.
- No secret value is ever rendered, returned or logged. `/api/test` reports `set`, `missing` or `invalid`.

## Development

```bash
npm test        # node:test suite, Shopify calls stubbed
npm run check   # syntax check of every source file
```

Node 24 on Vercel (`engines` in `package.json`). No runtime dependencies. Handlers use the Web `Request` and `Response` signature (`export default { fetch }`), so the tests call them directly without a server.

| File | Responsibility |
| --- | --- |
| `api/early-access.js` | Proxy check, input parsing, response codes |
| `lib/early-access.js` | Reading and validating the form |
| `lib/early-access-store.js` | Metaobject and metafield schema, entry upsert, customer link |
| `lib/files.js` | Screenshot upload to Shopify Files |
| `scripts/create-definitions.js` | One-time metaobject and metafield definitions |

`vercel.json` has a single rewrite from `/` to `/api` so the endpoint index renders at the root. File paths under `api/` are the router; do not add routing rewrites.

## Known limits and open items

- The popup UI itself is built in the theme, not in this repo.
- The progress bar has five steps ("4 questions + details"), but no design was supplied for the details step. The pass screen says "We've sent your pass to +91 ...": sending an SMS is not part of this API.
- Shopify Files URLs are public. Anyone who has a screenshot URL can open it. If screenshots must stay private, store them somewhere access-controlled instead.
- A new submission updates the customer's entry. A new screenshot replaces the `run_screenshot` reference; a submission without one keeps the previous reference. `screenshotSaved` says whether a screenshot was uploaded in this request. Replaced screenshots stay in Shopify Files.
- `GET /api/test` is public and makes one Admin API call per request, as the service contract requires. Put it behind Vercel Firewall rate limiting if it gets traffic.
- An earlier version of this API wrote eight flat `early_access.*` customer metafields. If `npm run definitions` from that version ran on a store, those definitions are no longer written to and can be deleted in admin.

### Verify on a development store before launch

Not confirmed against a live store yet:

1. A multipart upload reaches the function through the app proxy. Shopify documents that the proxy forwards POST bodies, but community reports about file uploads through it are mixed.
2. `metaobjectUpsert` accepts the `file_reference` straight after `fileCreate`, while the file is still processing. If it does not, the API needs to wait for `fileStatus: READY` first.
3. On an existing entry, `metaobjectUpsert` without `run_screenshot` keeps the previous screenshot rather than clearing it.
4. The customer page in admin shows the pinned `Early Access submission` metafield linking to the entry.
5. A request to `/apps/early-access?logged_in_customer_id=123` from a logged-in browser is refused (Shopify should add its own value, which the duplicate check rejects).
6. Whether the app proxy forwards the browser's `Origin` header unchanged. If it rewrites it to another value, legitimate submissions get `403`: check the function logs for `unexpected origin` on the first test and add that value to `SHOPIFY_STOREFRONT_ORIGIN`.
