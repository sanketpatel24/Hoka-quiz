var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// lib/early-access.js
var MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
var MAX_REQUEST_BYTES = 3 * 1024 * 1024;
var MAX_SURFACES = 10;
var ANSWER_HANDLE_MAX_LENGTH = 64;
var ANSWER_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var SHOE_SIZE_PATTERN = /^\d{1,2}(?:\.5)?$/;
var CUSTOMER_ID_PATTERN = /^[1-9]\d{0,19}$/;
var IMAGE_FORMATS = {
  "image/png": { extension: "png", signature: [137, 80, 78, 71, 13, 10, 26, 10] },
  "image/jpeg": { extension: "jpg", signature: [255, 216, 255] }
};
function isAnswerHandle(value) {
  return value.length <= ANSWER_HANDLE_MAX_LENGTH && ANSWER_HANDLE_PATTERN.test(value);
}
__name(isAnswerHandle, "isAnswerHandle");
function readText(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}
__name(readText, "readText");
function readHandle(formData, field, errors) {
  const value = readText(formData, field);
  if (!value) errors[field] = "required";
  else if (!isAnswerHandle(value)) errors[field] = "invalid";
  return value;
}
__name(readHandle, "readHandle");
function readSurfaces(formData, errors) {
  const values = [
    ...new Set(
      formData.getAll("surfaces").filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    )
  ];
  if (!values.length) errors.surfaces = "required";
  else if (values.length > MAX_SURFACES || !values.every(isAnswerHandle)) errors.surfaces = "invalid";
  return values;
}
__name(readSurfaces, "readSurfaces");
function readShoeSize(formData, errors) {
  const value = readText(formData, "shoe_size");
  if (!value) errors.shoe_size = "required";
  else if (!SHOE_SIZE_PATTERN.test(value) || Number(value) <= 0) errors.shoe_size = "invalid";
  return value;
}
__name(readShoeSize, "readShoeSize");
async function readScreenshot(formData, errors) {
  const file = formData.get("run_screenshot");
  if (!(file instanceof File) || file.size === 0) return null;
  const format = Object.hasOwn(IMAGE_FORMATS, file.type) ? IMAGE_FORMATS[file.type] : null;
  if (!format) {
    errors.run_screenshot = "unsupported_type";
    return null;
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    errors.run_screenshot = "too_large";
    return null;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!format.signature.every((byte, index) => bytes[index] === byte)) {
    errors.run_screenshot = "unsupported_type";
    return null;
  }
  return { bytes, mimeType: file.type, extension: format.extension };
}
__name(readScreenshot, "readScreenshot");
function readCustomerId(formData) {
  const value = readText(formData, "customerId");
  return CUSTOMER_ID_PATTERN.test(value) ? value : null;
}
__name(readCustomerId, "readCustomerId");
async function parseSubmission(formData) {
  const errors = {};
  const answers = {
    weekly_distance: readHandle(formData, "weekly_distance", errors),
    surfaces: readSurfaces(formData, errors),
    goal: readHandle(formData, "goal", errors),
    shoe_fit: readHandle(formData, "shoe_fit", errors),
    shoe_size: readShoeSize(formData, errors)
  };
  const screenshot = await readScreenshot(formData, errors);
  return Object.keys(errors).length ? { errors } : { answers, screenshot, errors: null };
}
__name(parseSubmission, "parseSubmission");

// lib/env.js
var STORE_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
var METAOBJECT_TYPE_PATTERN = /^[a-z0-9_-]{3,255}$/;
var CUSTOMER_METAFIELD_PATTERN = /^([a-zA-Z0-9_-]{3,255})\.([a-zA-Z0-9_-]{2,64})$/;
function toOrigin(value) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const isBareOrigin = url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    return isBareOrigin ? url.origin : null;
  } catch {
    return null;
  }
}
__name(toOrigin, "toOrigin");
function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
__name(splitList, "splitList");
function isOriginList(value) {
  const items = splitList(value);
  return items.length > 0 && items.every((item) => toOrigin(item));
}
__name(isOriginList, "isOriginList");
var ENV_SPEC = {
  SHOPIFY_STORE_DOMAIN: {
    purpose: "The store the API writes to, as store-name.myshopify.com. Admin API calls go here, and its https origin may always call the API.",
    required: true,
    isValid: /* @__PURE__ */ __name((value) => STORE_DOMAIN_PATTERN.test(value.toLowerCase()), "isValid")
  },
  SHOPIFY_STOREFRONT_ORIGIN: {
    purpose: "Storefront origin the popup calls the API from, such as https://www.example.com or www.example.com. Comma-separate several. Only these origins and the myshopify.com origin get CORS access; a request with any other Origin, or none, is refused.",
    required: true,
    isValid: isOriginList
  },
  SHOPIFY_ADMIN_TOKEN: {
    purpose: "Admin API access token (shpat_...) of the custom app installed on the store. Sent as X-Shopify-Access-Token on every Admin API call.",
    required: true,
    secret: true
  },
  EARLY_ACCESS_METAOBJECT_TYPE: {
    purpose: "Type of the metaobject that holds the quiz answers, such as early_access_submission. One entry per customer.",
    required: true,
    isValid: /* @__PURE__ */ __name((value) => METAOBJECT_TYPE_PATTERN.test(value), "isValid")
  },
  EARLY_ACCESS_CUSTOMER_METAFIELD: {
    purpose: "Customer metafield, as namespace.key, that points to the customer's metaobject entry, such as early_access.submission.",
    required: true,
    isValid: /* @__PURE__ */ __name((value) => CUSTOMER_METAFIELD_PATTERN.test(value), "isValid")
  }
};
function readEnv(name) {
  const value = process.env[name]?.trim();
  if (!value && ENV_SPEC[name]?.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
__name(readEnv, "readEnv");
function readValid(name, hint) {
  const value = readEnv(name);
  if (!ENV_SPEC[name].isValid(value)) throw new Error(`${name} must look like ${hint}`);
  return value;
}
__name(readValid, "readValid");
function readStoreDomain() {
  return readValid("SHOPIFY_STORE_DOMAIN", "store-name.myshopify.com").toLowerCase();
}
__name(readStoreDomain, "readStoreDomain");
function readStorefrontOrigins() {
  const configured = splitList(readValid("SHOPIFY_STOREFRONT_ORIGIN", "https://www.example.com")).map(toOrigin);
  return /* @__PURE__ */ new Set([...configured, `https://${readStoreDomain()}`]);
}
__name(readStorefrontOrigins, "readStorefrontOrigins");
function readMetaobjectType() {
  return readValid("EARLY_ACCESS_METAOBJECT_TYPE", "early_access_submission");
}
__name(readMetaobjectType, "readMetaobjectType");
function readCustomerMetafield() {
  const [, namespace, key] = readValid("EARLY_ACCESS_CUSTOMER_METAFIELD", "early_access.submission").match(
    CUSTOMER_METAFIELD_PATTERN
  );
  return { namespace, key };
}
__name(readCustomerMetafield, "readCustomerMetafield");
function statusOf(name, spec) {
  const value = process.env[name]?.trim();
  if (!value) return "missing";
  if (spec.isValid && !spec.isValid(value)) return "invalid";
  return "set";
}
__name(statusOf, "statusOf");
function envStatus() {
  return Object.entries(ENV_SPEC).map(([name, spec]) => ({
    name,
    purpose: spec.purpose,
    status: statusOf(name, spec)
  }));
}
__name(envStatus, "envStatus");

// lib/shopify.js
var API_VERSION = "2026-10";
var REQUIRED_SCOPES = ["write_customers", "write_files", "write_metaobjects"];
var ShopifyUserError = class extends Error {
  static {
    __name(this, "ShopifyUserError");
  }
  constructor(operation, userErrors) {
    super(`${operation} returned user errors`);
    this.userErrors = userErrors;
  }
};
async function adminGraphql(query, variables = {}) {
  const domain = readStoreDomain();
  const token = readEnv("SHOPIFY_ADMIN_TOKEN");
  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) {
    console.error("[shopify] GraphQL request failed", response.status, await response.text());
    throw new Error(`Shopify GraphQL request failed with status ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    console.error("[shopify] GraphQL errors", JSON.stringify(payload.errors));
    throw new Error("Shopify GraphQL request returned errors");
  }
  return payload.data;
}
__name(adminGraphql, "adminGraphql");
function assertNoUserErrors(operation, userErrors) {
  if (userErrors?.length) throw new ShopifyUserError(operation, userErrors);
}
__name(assertNoUserErrors, "assertNoUserErrors");

// lib/files.js
var STAGED_UPLOADS_CREATE = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;
var FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id }
      userErrors { field message code }
    }
  }
`;
async function stageUpload({ bytes, mimeType, filename }) {
  const data = await adminGraphql(STAGED_UPLOADS_CREATE, {
    input: [
      {
        resource: "IMAGE",
        filename,
        mimeType,
        httpMethod: "POST",
        fileSize: String(bytes.byteLength)
      }
    ]
  });
  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  assertNoUserErrors("stagedUploadsCreate", userErrors);
  const [target] = stagedTargets;
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) {
    console.error("[files] staged upload failed", response.status, await response.text());
    throw new Error(`Staged upload failed with status ${response.status}`);
  }
  return target.resourceUrl;
}
__name(stageUpload, "stageUpload");
async function uploadImage({ bytes, mimeType, filename, alt }) {
  const resourceUrl = await stageUpload({ bytes, mimeType, filename });
  const data = await adminGraphql(FILE_CREATE, {
    files: [{ originalSource: resourceUrl, contentType: "IMAGE", alt }]
  });
  const { files, userErrors } = data.fileCreate;
  assertNoUserErrors("fileCreate", userErrors);
  return files[0].id;
}
__name(uploadImage, "uploadImage");

// lib/early-access-store.js
var answerField = /* @__PURE__ */ __name((key, name, description, type = "single_line_text_field") => ({
  key,
  name,
  description,
  type,
  required: true
}), "answerField");
var METAOBJECT_DEFINITION = {
  name: "Early Access submission",
  description: "One entry per customer with the answers from the Early Access quiz popup.",
  displayNameKey: "pass_number",
  access: { storefront: "NONE" },
  fieldDefinitions: [
    answerField("pass_number", "Pass number", "Early Access pass number shown on the confirmation card."),
    answerField("weekly_distance", "Weekly distance", "Question 1: how far the customer runs in a week."),
    {
      key: "run_screenshot",
      name: "Run screenshot",
      description: "Question 1: screenshot of a recent run.",
      type: "file_reference",
      required: false,
      validations: [{ name: "file_type_options", value: '["Image"]' }]
    },
    answerField("surfaces", "Running surfaces", "Question 2: every surface the customer runs on.", "list.single_line_text_field"),
    answerField("goal", "Running goal", "Question 3: what the customer is running towards."),
    answerField("shoe_fit", "Shoe fit", "Question 4: men's or women's sizing."),
    answerField("shoe_size", "Shoe size (UK)", "Question 4: UK shoe size."),
    answerField("submitted_at", "Submitted at", "When the customer last submitted the quiz.", "date_time")
  ]
};
var CUSTOMER_METAFIELD = {
  type: "metaobject_reference",
  name: "Early Access submission",
  description: "The customer's Early Access submission entry."
};
var CUSTOMER_LOOKUP = `
  query EarlyAccessCustomer($id: ID!) {
    customer(id: $id) { id }
  }
`;
var METAOBJECT_UPSERT = `
  mutation EarlyAccessSubmissionUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;
var CUSTOMER_LINK_SET = `
  mutation EarlyAccessSubmissionLink($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;
function passNumberFor(customerId) {
  return BigInt(customerId).toString(36).toUpperCase();
}
__name(passNumberFor, "passNumberFor");
function submissionHandleFor(customerId) {
  return `customer-${customerId}`;
}
__name(submissionHandleFor, "submissionHandleFor");
function customerGid(customerId) {
  return `gid://shopify/Customer/${customerId}`;
}
__name(customerGid, "customerGid");
async function customerExists(customerId) {
  const data = await adminGraphql(CUSTOMER_LOOKUP, { id: customerGid(customerId) });
  return Boolean(data.customer);
}
__name(customerExists, "customerExists");
async function upsertEntry(customerId, metaobjectType, values) {
  const data = await adminGraphql(METAOBJECT_UPSERT, {
    handle: { type: metaobjectType, handle: submissionHandleFor(customerId) },
    metaobject: {
      fields: Object.entries(values).map(([key, value]) => ({ key, value }))
    }
  });
  const { metaobject, userErrors } = data.metaobjectUpsert;
  assertNoUserErrors("metaobjectUpsert", userErrors);
  return metaobject;
}
__name(upsertEntry, "upsertEntry");
async function linkToCustomer(customerId, { namespace, key }, entryId) {
  const data = await adminGraphql(CUSTOMER_LINK_SET, {
    metafields: [
      {
        ownerId: customerGid(customerId),
        namespace,
        key,
        type: CUSTOMER_METAFIELD.type,
        value: entryId
      }
    ]
  });
  assertNoUserErrors("metafieldsSet", data.metafieldsSet.userErrors);
}
__name(linkToCustomer, "linkToCustomer");
async function saveSubmission({ customerId, answers, screenshot, target }) {
  const passNumber = passNumberFor(customerId);
  const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
  const values = {
    pass_number: passNumber,
    ...answers,
    surfaces: JSON.stringify(answers.surfaces),
    submitted_at: submittedAt
  };
  if (screenshot) {
    values.run_screenshot = await uploadImage({
      bytes: screenshot.bytes,
      mimeType: screenshot.mimeType,
      filename: `early-access-run-${customerId}.${screenshot.extension}`,
      alt: "Recent run screenshot"
    });
  }
  const entry = await upsertEntry(customerId, target.metaobjectType, values);
  await linkToCustomer(customerId, target.customerMetafield, entry.id);
  return {
    passNumber,
    submittedAt,
    answers,
    screenshotSaved: Boolean(screenshot)
  };
}
__name(saveSubmission, "saveSubmission");

// lib/http.js
var PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
var STOREFRONT_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400"
};
function json(status, body, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}
__name(json, "json");
function fail(status, message, internal, extra = {}) {
  if (internal) console.error(`[error] ${message}:`, internal);
  return json(status, { ok: false, error: message, ...extra });
}
__name(fail, "fail");
function methodGate(request, methods) {
  if (methods.includes(request.method)) return null;
  return json(
    405,
    { ok: false, error: `Method ${request.method} not allowed` },
    { Allow: methods.join(", ") }
  );
}
__name(methodGate, "methodGate");
function publicPreflight(request) {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}
__name(publicPreflight, "publicPreflight");
function withStorefrontCors(response, origin) {
  response.headers.set("Access-Control-Allow-Origin", origin);
  for (const [name, value] of Object.entries(STOREFRONT_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.append("Vary", "Origin");
  return response;
}
__name(withStorefrontCors, "withStorefrontCors");
function withPublicCors(response) {
  for (const [name, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
__name(withPublicCors, "withPublicCors");

// api/early-access.js
var SIGN_IN_MESSAGE = "Sign in to join Early Access";
function readConfig() {
  const problems = envStatus().filter(({ status }) => status !== "set");
  if (problems.length) {
    throw new Error(problems.map(({ name, status }) => `${name} ${status}`).join(", "));
  }
  return {
    storefrontOrigins: readStorefrontOrigins(),
    target: { metaobjectType: readMetaobjectType(), customerMetafield: readCustomerMetafield() }
  };
}
__name(readConfig, "readConfig");
async function submit(request, target) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return fail(413, "Upload is too large", null, { code: "too_large" });
  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return fail(400, "Send the answers as form data", error.message);
  }
  const customerId = readCustomerId(formData);
  if (!customerId) return fail(401, SIGN_IN_MESSAGE, null, { code: "not_logged_in" });
  let submission;
  try {
    submission = await parseSubmission(formData);
  } catch (error) {
    return fail(400, "Could not read the answers", error);
  }
  const { answers, screenshot, errors } = submission;
  if (errors) return fail(400, "Some answers need attention", null, { code: "invalid_answers", fields: errors });
  try {
    if (!await customerExists(customerId)) {
      return fail(401, SIGN_IN_MESSAGE, `unknown customer ${customerId}`, { code: "not_logged_in" });
    }
    const result = await saveSubmission({ customerId, answers, screenshot, target });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return fail(502, "Could not save your answers", error.userErrors ?? error);
  }
}
__name(submit, "submit");
async function handle(request) {
  const blocked = methodGate(request, ["POST", "OPTIONS"]);
  if (blocked) return blocked;
  let config;
  try {
    config = readConfig();
  } catch (error) {
    return fail(503, "Service not configured", error.message);
  }
  const origin = request.headers.get("origin");
  if (!origin || !config.storefrontOrigins.has(origin)) {
    return fail(403, "Request must come from the store", `unexpected origin ${origin ?? "(none)"}`);
  }
  const response = request.method === "OPTIONS" ? new Response(null, { status: 204 }) : await submit(request, config.target);
  return withStorefrontCors(response, origin);
}
__name(handle, "handle");
var early_access_default = { fetch: handle };

// lib/service.js
var SERVICE_NAME = "Early Access metafields API";

// api/health.js
function handle2(request) {
  const preflight = publicPreflight(request);
  if (preflight) return preflight;
  const blocked = methodGate(request, ["GET"]);
  if (blocked) return withPublicCors(blocked);
  return withPublicCors(json(200, { ok: true, service: SERVICE_NAME, time: (/* @__PURE__ */ new Date()).toISOString() }));
}
__name(handle2, "handle");
var health_default = { fetch: handle2 };

// api/test.js
var CONNECTION_QUERY = `
  query ConnectionCheck {
    shop { myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }
`;
async function checkShopify() {
  try {
    const { shop, currentAppInstallation } = await adminGraphql(CONNECTION_QUERY);
    const granted = new Set(currentAppInstallation.accessScopes.map(({ handle: handle5 }) => handle5));
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
    if (missingScopes.length) {
      return {
        ok: false,
        detail: `Connected to ${shop.myshopifyDomain} but the app is missing scopes: ${missingScopes.join(", ")}`
      };
    }
    return { ok: true, detail: `Connected to ${shop.myshopifyDomain} with ${REQUIRED_SCOPES.join(", ")}` };
  } catch (error) {
    console.error("[test] Shopify check failed", error);
    return { ok: false, detail: error.message };
  }
}
__name(checkShopify, "checkShopify");
async function handle3(request) {
  const preflight = publicPreflight(request);
  if (preflight) return preflight;
  const blocked = methodGate(request, ["GET"]);
  if (blocked) return withPublicCors(blocked);
  const environment = envStatus();
  const incomplete = environment.some((entry) => entry.status !== "set");
  const upstream = incomplete ? { ok: false, detail: "skipped - environment missing or invalid" } : await checkShopify();
  const ok = !incomplete && upstream.ok;
  return withPublicCors(
    json(ok ? 200 : 503, { ok, environment, upstream, time: (/* @__PURE__ */ new Date()).toISOString() })
  );
}
__name(handle3, "handle");
var test_default = { fetch: handle3 };

// api/index.js
var ENDPOINTS = [
  {
    method: "POST",
    path: "/api/early-access",
    auth: "SHOPIFY_STOREFRONT_ORIGIN",
    description: "Called from the storefront popup when the shopper presses Continue on question 4, with the signed-in customer's customerId and the answers as form data. Creates or updates that customer's entry of the EARLY_ACCESS_METAOBJECT_TYPE metaobject with all four answers and the optional run screenshot, then links it from the EARLY_ACCESS_CUSTOMER_METAFIELD customer metafield. Only browsers on a SHOPIFY_STOREFRONT_ORIGIN origin may call it."
  },
  {
    method: "GET",
    path: "/api/test",
    auth: "public",
    link: true,
    description: `Configuration check: reports each environment variable as set, missing or invalid, then confirms the Admin API connection and the ${REQUIRED_SCOPES.join(", ")} scopes.`
  },
  {
    method: "GET",
    path: "/api/health",
    auth: "public",
    link: true,
    description: "Liveness only. Reads no environment and makes no Shopify call."
  }
];
var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var escape = /* @__PURE__ */ __name((value) => String(value).replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]), "escape");
function endpointRow({ method, path, auth, description, link }) {
  const label = `${method} ${path}`;
  const name = link ? `<a href="${escape(path)}">${escape(label)}</a>` : escape(label);
  const credential = auth === "public" ? '<span class="public">public</span>' : `<code>${escape(auth)}</code>`;
  return `<tr>
    <td class="endpoint">${name}</td>
    <td class="auth">${credential}</td>
    <td class="description">${escape(description)}</td>
  </tr>`;
}
__name(endpointRow, "endpointRow");
function envRow([name, spec]) {
  return `<tr>
    <td class="endpoint"><code>${escape(name)}</code></td>
    <td class="description">${escape(spec.purpose)}</td>
  </tr>`;
}
__name(envRow, "envRow");
function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${escape(SERVICE_NAME)}</title>
<style>
  :root { color-scheme: dark; --bg: #0d0d0d; --fg: #f5f5f5; --muted: #a1a1a1; --line: #262626; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4rem 1.5rem; background: var(--bg); color: var(--fg);
         font: 16px/1.6 ui-sans-serif, -apple-system, system-ui, sans-serif; }
  main { max-width: 56rem; margin: 0 auto; }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: var(--muted); font-weight: 600; margin: 3rem 0 .75rem; }
  .lede { color: var(--muted); margin: 0 0 2.5rem; max-width: 42rem; }
  .note { color: var(--muted); margin: 1rem 0 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .7rem 1rem .7rem 0; vertical-align: top; border-top: 1px solid var(--line); }
  tr:first-child td { border-top: 0; }
  .endpoint { white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size: .875rem; width: 1%; }
  .auth { width: 1%; white-space: nowrap; }
  .description { color: var(--muted); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; color: var(--fg); }
  .public { color: var(--muted); font-size: .8125rem; }
  a { color: var(--fg); }
  @media (max-width: 40rem) {
    body { padding: 2.5rem 1rem; }
    td { display: block; border-top: 0; padding: .15rem 0; }
    tr { display: block; padding: .7rem 0; border-top: 1px solid var(--line); }
    .endpoint, .auth { width: auto; white-space: normal; }
  }
</style>
</head>
<body>
<main>
  <h1>${escape(SERVICE_NAME)}</h1>
  <p class="lede">Service is running. There is no UI here. The storefront Early Access popup posts its answers straight to the endpoint below, the same way the Notify Me button calls the commerce backend.</p>

  <h2>Endpoints</h2>
  <table>${ENDPOINTS.map(endpointRow).join("")}</table>

  <h2>Environment</h2>
  <table>${Object.entries(ENV_SPEC).map(envRow).join("")}</table>
  <p class="note">Names only. Check whether this deployment has them set at <a href="/api/test">/api/test</a>.</p>
</main>
</body>
</html>`;
}
__name(renderPage, "renderPage");
function handle4(request) {
  const blocked = methodGate(request, ["GET", "HEAD"]);
  if (blocked) return blocked;
  return new Response(renderPage(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
__name(handle4, "handle");
var api_default = { fetch: handle4 };

// worker.js
var routes = {
  "/api/early-access": early_access_default,
  "/api/health": health_default,
  "/api/test": test_default,
  "/api": api_default,
  "/": api_default
};
var worker_default = {
  async fetch(request, env, ctx) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") process.env[key] ??= value;
    }
    const { pathname } = new URL(request.url);
    const handler = routes[pathname.replace(/\/$/, "") || "/"];
    if (!handler) return new Response("Not found", { status: 404 });
    return handler.fetch(request, env, ctx);
  }
};

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-onvz0V/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-onvz0V/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
