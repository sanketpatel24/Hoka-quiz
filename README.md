# Early Access metafields API

Saves the answers a signed-in customer gives in the storefront Early Access quiz popup (the five Figma screens: weekly distance and run screenshot, running surfaces, running goal, shoe size, then the "You're on the list" pass). When the shopper presses Continue on question 4, the popup posts every answer once. The API creates a metaobject entry holding all of them (type `early_access_submission`) and sets that entry on the customer's `early_access.submission` metafield. Both names come from environment variables.

## How it works

```
Storefront popup (theme), Continue on question 4
  POST https://<deployment>/api/early-access
       multipart form: customerId (from KwikPass) + every answer
        |
        v
Worker  POST /api/early-access
  1. refuse a browser Origin that is not in SHOPIFY_STOREFRONT_ORIGIN (CORS)
  2. refuse a missing or malformed customerId (401 not_logged_in)
  3. validate the answers and the screenshot
  4. customer(id): refuse an ID that is not a customer of the store
  5. screenshot -> stagedUploadsCreate -> upload -> fileCreate (Shopify Files)
  6. metaobjectUpsert: entry of type EARLY_ACCESS_METAOBJECT_TYPE,
     handle customer-<id>, with every answer
  7. metafieldsSet: customer EARLY_ACCESS_CUSTOMER_METAFIELD = that entry
        |
        v
JSON back to the popup: pass number, saved answers
```

Why an API at all: the theme cannot create metaobjects or write customer metafields itself. Liquid customer forms have no metafield fields, and the Storefront API cannot write either. Writing needs the Admin API, and the Admin API token must never reach the browser.

Why a direct call and not a Shopify app proxy: the store signs customers in with KwikPass, which never starts a Shopify customer session. An app proxy would always forward an empty `logged_in_customer_id`, so every submission would be refused as logged out, and on a password-protected store the proxy redirects to `/password` anyway. The popup therefore calls the API the same way the Notify Me button calls the commerce backend's `/launch/notify`: straight to the worker URL with the KwikPass customer ID in the body. See [Security](#security) for what that trusts.

Why upsert: each customer has exactly one entry, found by its handle `customer-<id>`. The first submission creates it; a later one updates it in place, so a customer who retakes the quiz never leaves a stray entry behind. If linking fails after the entry was saved, sending the quiz again finishes the job without a duplicate.

## Setup

### 1. Create the Shopify app

In Shopify admin, open Settings > Apps and sales channels > Develop apps, create a custom app and give it:

- Access scopes:

  | Scope | Why |
  | --- | --- |
  | `write_customers` | Set the `EARLY_ACCESS_CUSTOMER_METAFIELD` metafield on the customer |
  | `write_files` | Upload the run screenshot to Shopify Files |
  | `write_metaobjects` | Create and update the Early Access submission entries |
  | `write_metaobject_definitions` | Only for `npm run definitions` in step 3. Can be removed after setup. |

  Each write scope includes its read scope. No other scope is needed.
- Protected customer data: if a submission fails with "This app is not approved to access the Customer object" in the function logs, request protected customer data access for the app. Level 1 is enough: the API reads no name, email, phone or address.
- No app proxy. If one was set up for `/apps/early-access` earlier, it is no longer used and can be removed.

Install the app on the store, then copy its Admin API access token (`shpat_...`) into `SHOPIFY_ADMIN_TOKEN`. Shopify shows it once; the API sends it as-is on every request, so it does not expire.

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
vercel env add SHOPIFY_ADMIN_TOKEN production
vercel env add EARLY_ACCESS_METAOBJECT_TYPE production
vercel env add EARLY_ACCESS_CUSTOMER_METAFIELD production
vercel --prod
```

On Cloudflare Workers (`worker.js`, `wrangler.jsonc`), the four non-secret variables live under `vars` in `wrangler.jsonc`, so every deploy carries them. Add `SHOPIFY_ADMIN_TOKEN` as a secret, with `npx wrangler secret put <NAME>` or in the dashboard under the worker's Settings > Variables and Secrets with type Secret. Secrets survive deploys; a plain Text variable added in the dashboard is deleted by the next deploy from `wrangler.jsonc`.

Redeploy after changing any variable. Then put `https://<deployment>/api/early-access` into the theme under Theme settings > Early access > Early Access API endpoint.

All five are required. A missing or malformed value makes the write endpoint answer `503` and `/api/test` name the variable.

| Variable | Example | Purpose |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `store-name.myshopify.com` | The store the API writes to. Its `https` origin may always call the API. |
| `SHOPIFY_STOREFRONT_ORIGIN` | `https://www.example.com` | Storefront origin the popup calls the API from; a bare host means `https`. Comma-separate several. Only these origins get CORS access; a request with any other `Origin`, or none, is refused with `403`. `https://<SHOPIFY_STORE_DOMAIN>` is always allowed. |
| `SHOPIFY_ADMIN_TOKEN` | `shpat_...` | Admin API access token of the custom app installed on the store. Secret. |
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

Open the popup only for a signed-in customer. In the HOKA India theme that is the `hoka:notify-me:subscribed` event, whose `detail.customerId` comes from `window.HokaLogin` (KwikPass). Collect the answers across questions 1 to 4 in one `<form>` and send it once, when the shopper presses Continue on question 4.

### Request

`POST https://<deployment>/api/early-access` from a page on a `SHOPIFY_STOREFRONT_ORIGIN` origin, with the popup's `<form>` as `FormData` plus the customer ID:

| Field | Required | Value |
| --- | --- | --- |
| `customerId` | yes | The signed-in customer's numeric Shopify ID, the same value Notify Me sends |
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
const data = new FormData(form);
data.set('customerId', customerId);
const response = await fetch('https://<deployment>/api/early-access', {
  method: 'POST',
  body: data,
  headers: { Accept: 'application/json' },
});
const result = await response.json().catch(() => null);
```

Do not set `Content-Type` yourself; the browser adds the multipart boundary. Wrap the call in `try`/`catch` and show an error state on network failure. Show the pass screen only after a `200`.

### Responses

| Status | Body | Show |
| --- | --- | --- |
| `200` | `{ ok: true, passNumber, submittedAt, answers, screenshotSaved }` | The pass screen |
| `400` | `{ ok: false, code: 'invalid_answers', fields: { goal: 'required' } }` | The error next to each field in `fields` |
| `401` | `{ ok: false, code: 'not_logged_in' }` | The sign-in prompt. `customerId` was missing, malformed, or not a customer of the store. |
| `403` | `{ ok: false }`, no CORS headers | Nothing readable: the browser blocks the response. The page's origin is not in `SHOPIFY_STOREFRONT_ORIGIN`. |
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

- **The API trusts the `customerId` the browser sends.** That is the same trust model as the Notify Me call to the commerce backend: KwikPass gives the theme a customer ID but no token the API can verify. Anyone who knows or guesses a customer's numeric ID can therefore send answers, and a screenshot, in that customer's name and replace what the customer submitted. Accept this only because the data is low value: quiz answers, never personal details. If KwikPass can issue a verifiable session token, or customers move to Shopify customer accounts (where an app proxy signs `logged_in_customer_id`), switch to that.
- What limits it: the browser `Origin` must be in `SHOPIFY_STOREFRONT_ORIGIN` or be the myshopify.com origin, so other websites cannot post from a shopper's browser, and a request with no `Origin` is refused. A script outside a browser can still fake the header. The ID must be a real customer of the store, checked with the Admin API before anything is uploaded or written, so random IDs create no entries or files.
- The request cannot choose which entry gets updated: the entry handle is built from the customer ID.
- Screenshot uploads are limited to PNG and JPG up to 2 MB, checked by file signature.
- Metaobject entries are not readable from the storefront (storefront access `NONE`).
- Errors returned to the browser are short and generic. Shopify responses and stack traces go to the function logs only (Vercel or Cloudflare Workers).
- No secret value is ever rendered, returned or logged. `/api/test` reports `set`, `missing` or `invalid`.

## Development

```bash
npm test        # node:test suite, Shopify calls stubbed
npm run check   # syntax check of every source file
```

Node 24 on Vercel (`engines` in `package.json`). No runtime dependencies. Handlers use the Web `Request` and `Response` signature (`export default { fetch }`), so the tests call them directly without a server.

| File | Responsibility |
| --- | --- |
| `worker.js` | Cloudflare Workers entry: copies bindings into `process.env` and routes paths to the `api/` handlers |
| `api/early-access.js` | Origin and CORS check, input parsing, response codes |
| `lib/early-access.js` | Reading and validating the form and the customer ID |
| `lib/early-access-store.js` | Metaobject and metafield schema, customer lookup, entry upsert, customer link |
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

1. The theme's Early Access API endpoint setting holds the worker URL, not `/apps/early-access`, and a submission from the Coming Soon page answers `200`.
2. `metaobjectUpsert` accepts the `file_reference` straight after `fileCreate`, while the file is still processing. If it does not, the API needs to wait for `fileStatus: READY` first.
3. On an existing entry, `metaobjectUpsert` without `run_screenshot` keeps the previous screenshot rather than clearing it.
4. The customer page in admin shows the pinned `Early Access submission` metafield linking to the entry.
5. If a submission gets `403`, the worker logs show `unexpected origin <value>`. Add that value to `SHOPIFY_STOREFRONT_ORIGIN`.
