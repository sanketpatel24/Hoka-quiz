# Early Access metafields API

Saves the answers a signed-in customer gives in the storefront Early Access quiz popup. The Figma flow has three questions, then the "You're on the list" ticket:

1. How many kilometres have you run this year? A number, plus an optional screenshot of the yearly total.
2. Which surface do you run on? Pick all that apply.
3. What are you running towards? Pick one.

When the shopper presses Continue on question 3, the popup posts every answer once. The API creates a metaobject entry holding only those answers and a random ticket number such as `IN-39561` for the confirmation ticket (type `early_access_submission`), and sets that entry on the customer's `early_access.submission` metafield. Both names come from environment variables. Nothing else about the customer is stored.

## How it works

```
Storefront popup (theme), Continue on question 3
  POST https://<deployment>/api/early-access
       multipart form: customerId (from KwikPass) + every answer
        |
        v
Worker  POST /api/early-access
  1. refuse a browser Origin that is not in SHOPIFY_STOREFRONT_ORIGIN (CORS)
  2. refuse a missing or malformed customerId (401 not_logged_in)
  3. validate the answers and the screenshot
  4. customer(id) + metaobjectByHandle: refuse an ID that is not a customer
     of the store, and read the ticket number the customer already has
  5. no ticket yet: draw a random IN-<5 digits> and check no entry has it
  6. screenshot -> stagedUploadsCreate -> upload -> fileCreate (Shopify Files)
  7. metaobjectUpsert: entry of type EARLY_ACCESS_METAOBJECT_TYPE,
     handle customer-<id>, with the ticket, the three answers and the screenshot
  8. metafieldsSet: customer EARLY_ACCESS_CUSTOMER_METAFIELD = that entry
        |
        v
JSON back to the popup: ticket number, saved answers
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
  | `write_files` | Upload the yearly total screenshot to Shopify Files |
  | `write_metaobjects` | Create and update the Early Access submission entries |
  | `write_metaobject_definitions` | Only for `npm run definitions` in step 3. Can be removed after setup, but add it back before running the script again. |

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

### 3. Create or update the definitions (before the first submission, and after every field change)

```bash
npm run definitions
```

Reads `.env.local` (it needs `SHOPIFY_ADMIN_TOKEN` filled in) and, in this order:

1. Creates the metaobject definition named by `EARLY_ACCESS_METAOBJECT_TYPE` with the fields in the registry below. If it already exists, updates it in place in one atomic call:
   - adds missing fields,
   - syncs the name, description, required flag and validations of the fields that are already there,
   - makes every field that is no longer in the registry optional, so new submissions do not fail on it, and leaves its saved values alone,
   - puts the fields in registry order.

   A field that exists with a different type stops the script before anything changes. Shopify cannot change a field's type; delete that field in admin first.
2. Creates the customer metafield definition named by `EARLY_ACCESS_CUSTOMER_METAFIELD`, type `metaobject_reference`, restricted to that metaobject definition and pinned so it shows on the customer page in admin. If it exists, it is reported and left alone.

Safe to run again. Without the definitions every submission fails with `502`, because a `metaobject_reference` metafield needs its definition.

To also delete the fields that are no longer in the registry:

```bash
npm run definitions -- --prune
```

This deletes those fields **and the values every entry saved in them**. It cannot be undone. Export the entries first (Content > Metaobjects > Early Access submission) if the old answers might still be needed.

### 4. Check the deployment

- `https://<deployment>/` lists every endpoint and the variables it needs.
- `https://<deployment>/api/health` answers `200` when the function runs.
- `https://<deployment>/api/test` answers `200` only when all variables are set and well formed, the Admin API connects, and `write_customers`, `write_files` and `write_metaobjects` are granted. Otherwise `503` with the reason. It does not check that step 3 has run.

## Metaobject and metafield registry

Names below are the values in `.env.example`.

### Metaobject `early_access_submission` (`EARLY_ACCESS_METAOBJECT_TYPE`)

One entry per customer, handle `customer-<customer id>`, display name from `ticket_number`, so admin lists and searches entries by ticket. Storefront access is off (see [Reading the answers in Liquid](#reading-the-answers-in-liquid)).

| Key | Type | Required | Validation | Content |
| --- | --- | --- | --- | --- |
| `ticket_number` | `single_line_text_field` | yes | regex `^IN-[0-9]{5}$` | Ticket number on the confirmation ticket, for example `IN-39561` |
| `yearly_distance_km` | `number_decimal` | yes | 0 to 20000, up to 2 decimals | Question 1: total kilometres run this year, for example `850` or `1234.5` |
| `yearly_distance_screenshot` | `file_reference` | no | images only | Question 1: screenshot of the year-to-date total, stored in Shopify Files |
| `surfaces` | `list.single_line_text_field` | yes | | Question 2 answer handles, for example `["road","trail"]` |
| `goal` | `single_line_text_field` | yes | | Question 3 answer handle, for example `half-marathon` |

### Customer metafield `early_access.submission` (`EARLY_ACCESS_CUSTOMER_METAFIELD`)

| Owner | Type | Content |
| --- | --- | --- |
| Customer | `metaobject_reference` to `early_access_submission` | The customer's entry |

For questions 2 and 3 the API stores answer handles, not labels. Question text and answer labels belong in the theme, editable by the merchant and translated through locale files, so the API accepts any lowercase handle (letters, digits, hyphens, up to 64 characters) instead of a fixed list. Keep handles stable once customers have answered, because existing entries keep the old handle.

The ticket number is `IN-` and a random five-digit number from `10000` to `99999`, drawn with `crypto.getRandomValues`. It is issued on the customer's first submission and stored in `ticket_number`; a customer who answers again keeps the same ticket. Before using a new number the API searches the entries by display name and draws again if another entry already has it, up to five times. The API returns it ready to show (`IN-39561`), so the theme prints it as is. Prefix and length are constants in `lib/ticket-number.js`.

The metaobject type and the metafield namespace and key come from the environment; the field keys and validations, the kilometre limits and the ticket format are constants in `lib/early-access-store.js`, `lib/early-access.js` and `lib/ticket-number.js`. After changing a field, run step 3 again before deploying the API. Never rename the metaobject type or the customer metafield after customers have submitted: existing entries and links keep the old names and the API would stop finding them.

#### Fields from the earlier quiz

The first version of the quiz had four questions and stored `pass_number`, `weekly_distance`, `run_screenshot`, `shoe_fit`, `shoe_size` and `submitted_at`. The API no longer writes any of them. On a store where the old definition exists, `npm run definitions` makes them optional and `npm run definitions -- --prune` deletes them (see step 3). Screenshots uploaded for `run_screenshot` stay in Shopify Files until deleted there.

## Storefront contract

Open the popup only for a signed-in customer. In the HOKA India theme that is the `hoka:notify-me:subscribed` event, whose `detail.customerId` comes from `window.HokaLogin` (KwikPass). Collect the answers across questions 1 to 3 in one `<form>` and send it once, when the shopper presses Continue on question 3.

### Request

`POST https://<deployment>/api/early-access` from a page on a `SHOPIFY_STOREFRONT_ORIGIN` origin, with the popup's `<form>` as `FormData` plus the customer ID:

| Field | Required | Value |
| --- | --- | --- |
| `customerId` | yes | The signed-in customer's numeric Shopify ID, the same value Notify Me sends |
| `yearly_distance_km` | yes | Question 1: kilometres run this year, digits with an optional `.` and up to 2 decimals, from `0` to `20000`. No unit, spaces or thousands separators. |
| `yearly_distance_screenshot` | no | Question 1: PNG or JPG file, up to 2 MB. The content is checked, not only the extension. |
| `surfaces` | yes | Question 2: one or more answer handles, one field per checked box |
| `goal` | yes | Question 3: one answer handle |

For question 1, `<input type="number" name="yearly_distance_km" min="0" max="20000" step="0.01" inputmode="decimal" required>` sends a value the API accepts and lets the browser catch most mistakes before the request.

Answer handles for the options in the Figma screens. The API accepts any valid handle, so these are the theme's choice; use them unless there is a reason not to, and keep them stable once customers have answered.

| Question | Field | Option label | Handle |
| --- | --- | --- | --- |
| 2 Which surface do you run on? (pick all) | `surfaces` | Road | `road` |
| | | Trail | `trail` |
| | | Track | `track` |
| | | Treadmill | `treadmill` |
| 3 What are you running towards? | `goal` | Moving every day | `moving-every-day` |
| | | A first 10K | `first-10k` |
| | | A half marathon | `half-marathon` |
| | | A full marathon | `full-marathon` |
| | | An ultra or trail race | `ultra-or-trail-race` |

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

Do not set `Content-Type` yourself; the browser adds the multipart boundary. Wrap the call in `try`/`catch` and show an error state on network failure. Show the ticket screen only after a `200`.

### Responses

| Status | Body | Show |
| --- | --- | --- |
| `200` | `{ ok: true, ticketNumber, answers, screenshotSaved }`, where `ticketNumber` is like `IN-39561`, where `answers` is `{ yearly_distance_km, surfaces, goal }` and `yearly_distance_km` is a number | The ticket screen |
| `400` | `{ ok: false, code: 'invalid_answers', fields: { goal: 'required' } }` | The error next to each field in `fields` |
| `401` | `{ ok: false, code: 'not_logged_in' }` | The sign-in prompt. `customerId` was missing, malformed, or not a customer of the store. |
| `403` | `{ ok: false }`, no CORS headers | Nothing readable: the browser blocks the response. The page's origin is not in `SHOPIFY_STOREFRONT_ORIGIN`. |
| `413` | `{ ok: false, code: 'too_large' }` | The file-size error |
| `502`, `503` | `{ ok: false }` | A generic "try again" error |

Field error codes are `required`, `invalid`, `unsupported_type` and `too_large`. They are codes, not sentences, so the theme maps each one to a translated string. Do not show the `error` text from the API to shoppers: it is English only and meant for developers.

The ticket card takes the ticket number from the `200` response. The rest comes from the theme: the first name from `customer.first_name`, the opening date and the notification date from section settings.

### Reading the answers in Liquid

Off by default. The metaobject definition is created with storefront access `NONE`, so `customer.metafields.early_access.submission.value` is empty in Liquid and the entries are visible only in admin.

Liquid can read a metaobject only when its definition has storefront access, and that same setting lets the Storefront API list every entry of the type with the public storefront token. That would expose every customer's ticket number, answers and screenshot URL to anyone who queries it. Keep it off unless that is acceptable.

If it is, turn on Storefronts access for `Early Access submission` in Settings > Custom data > Metaobjects, then:

```liquid
{%- assign submission = customer.metafields.early_access.submission.value -%}
{%- if submission -%}
  {{ submission.ticket_number.value }}
  {{ submission.yearly_distance_km.value }}
  {{ submission.goal.value }}
  {%- for surface in submission.surfaces.value -%}{{ surface }}{%- endfor -%}
  {{ submission.yearly_distance_screenshot.value | image_url: width: 400 | image_tag }}
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
| `lib/ticket-number.js` | Random ticket number and the check that no other entry has it |
| `lib/definition-sync.js` | Plans the field changes that bring an existing metaobject definition in line with the registry |
| `scripts/sync-definitions.js` | Creates or updates the metaobject and metafield definitions (`npm run definitions`) |

`vercel.json` has a single rewrite from `/` to `/api` so the endpoint index renders at the root. File paths under `api/` are the router; do not add routing rewrites.

## Known limits and open items

- The popup UI itself is built in the theme, not in this repo.
- The progress bar in the Figma screens still has five segments (its component note says "4 questions + details") while the header says "Question 1 of 3". The theme should show three steps unless design says otherwise. The ticket screen says the customer will be notified by email: sending that email is not part of this API.
- Question 1's subtitle in Figma still reads "Pick your average, then add a screenshot of a recent run.", left over from the weekly question. The screenshot is optional in the API; if design makes it mandatory, set `required: true` on `yearly_distance_screenshot` in `lib/early-access-store.js`, make it required in `lib/early-access.js`, and run `npm run definitions`.
- Five digits give 90,000 ticket numbers. Each new ticket costs one Admin API search, more when a drawn number is taken. Near capacity, draws fail more often and a submission can end in `502` after five taken draws; raise `TICKET_DIGITS` before that. The search runs on Shopify's search index, which can lag a few seconds behind new entries, so two customers who sign up in the same few seconds could in theory draw the same number.
- Shopify Files URLs are public. Anyone who has a screenshot URL can open it. If screenshots must stay private, store them somewhere access-controlled instead.
- A new submission updates the customer's entry. A new screenshot replaces the `yearly_distance_screenshot` reference; a submission without one keeps the previous reference. `screenshotSaved` says whether a screenshot was uploaded in this request. Replaced screenshots stay in Shopify Files.
- `GET /api/test` is public and makes one Admin API call per request, as the service contract requires. Put it behind Vercel Firewall rate limiting if it gets traffic.
- An earlier version of this API wrote eight flat `early_access.*` customer metafields. If `npm run definitions` from that version ran on a store, those definitions are no longer written to and can be deleted in admin.
- The theme form and this API change together: a form from the old four-question popup has no `yearly_distance_km`, so it gets `400 invalid_answers`, and its old fields are ignored. Deploy order: `npm run definitions`, then the API, then the theme with the three-question popup, then optionally `npm run definitions -- --prune`.

### Verify on a development store before launch

Not confirmed against a live store yet:

1. The theme's Early Access API endpoint setting holds the worker URL, not `/apps/early-access`, and a submission from the Coming Soon page answers `200`.
2. `metaobjectUpsert` accepts the `file_reference` straight after `fileCreate`, while the file is still processing. If it does not, the API needs to wait for `fileStatus: READY` first.
3. On an existing entry, `metaobjectUpsert` without `yearly_distance_screenshot` keeps the previous screenshot rather than clearing it.
4. The customer page in admin shows the pinned `Early Access submission` metafield linking to the entry.
5. If a submission gets `403`, the worker logs show `unexpected origin <value>`. Add that value to `SHOPIFY_STOREFRONT_ORIGIN`.
6. On a store that already has the old definition, `npm run definitions` adds the required `ticket_number` field and makes it the display name in one call. If Shopify refuses a new required field while entries exist, the whole update is rejected and nothing changes: delete the old test entries, or add the field as optional in admin, then run it again.
7. `metaobjectByHandle` answers `null`, not an error, for a customer who has no entry yet.
8. A search for `display_name:"IN-39561"` finds an entry whose ticket is `IN-39561`. Check it in admin with a real entry before launch.
