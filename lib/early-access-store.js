import { MAX_YEARLY_DISTANCE_KM, YEARLY_DISTANCE_DECIMALS } from './early-access.js';
import { uploadImage } from './files.js';
import { adminGraphql, assertNoUserErrors } from './shopify.js';
import { TICKET_NUMBER_REGEX, ticketNumberFor } from './ticket-number.js';

export const METAOBJECT_DEFINITION = {
  name: 'Early Access submission',
  description: 'One entry per customer with the Early Access ticket number and the answers from the three quiz questions.',
  displayNameKey: 'ticket_number',
  access: { storefront: 'NONE' },
  fieldDefinitions: [
    {
      key: 'ticket_number',
      name: 'Ticket number',
      description:
        "Early Access ticket number shown on the confirmation ticket: the first letter of the customer's first name, IN- and the last five digits of the customer ID.",
      type: 'single_line_text_field',
      required: true,
      validations: [{ name: 'regex', value: TICKET_NUMBER_REGEX }],
    },
    {
      key: 'yearly_distance_km',
      name: 'Kilometres this year',
      description: 'Question 1: total kilometres the customer has run this year.',
      type: 'number_decimal',
      required: true,
      validations: [
        { name: 'min', value: '0' },
        { name: 'max', value: String(MAX_YEARLY_DISTANCE_KM) },
        { name: 'max_precision', value: String(YEARLY_DISTANCE_DECIMALS) },
      ],
    },
    {
      key: 'yearly_distance_screenshot',
      name: 'Yearly total screenshot',
      description: 'Question 1: screenshot of the year-to-date distance from a running app.',
      type: 'file_reference',
      required: false,
      validations: [{ name: 'file_type_options', value: '["Image"]' }],
    },
    {
      key: 'surfaces',
      name: 'Running surfaces',
      description: 'Question 2: every surface the customer runs on.',
      type: 'list.single_line_text_field',
      required: true,
    },
    {
      key: 'goal',
      name: 'Running goal',
      description: 'Question 3: what the customer is running towards.',
      type: 'single_line_text_field',
      required: true,
    },
  ],
};

export const CUSTOMER_METAFIELD = {
  type: 'metaobject_reference',
  name: 'Early Access submission',
  description: "The customer's Early Access submission entry.",
};

const CUSTOMER_LOOKUP = `
  query EarlyAccessCustomer($id: ID!) {
    customer(id: $id) { id firstName lastName }
  }
`;

const METAOBJECT_UPSERT = `
  mutation EarlyAccessSubmissionUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

const CUSTOMER_LINK_SET = `
  mutation EarlyAccessSubmissionLink($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

function submissionHandleFor(customerId) {
  return `customer-${customerId}`;
}

function customerGid(customerId) {
  return `gid://shopify/Customer/${customerId}`;
}

export async function findCustomer(customerId) {
  const { customer } = await adminGraphql(CUSTOMER_LOOKUP, { id: customerGid(customerId) });
  if (!customer) return null;
  return {
    ticketNumber: ticketNumberFor({ customerId, firstName: customer.firstName, lastName: customer.lastName }),
  };
}

async function upsertEntry(customerId, metaobjectType, values) {
  const data = await adminGraphql(METAOBJECT_UPSERT, {
    handle: { type: metaobjectType, handle: submissionHandleFor(customerId) },
    metaobject: {
      fields: Object.entries(values).map(([key, value]) => ({ key, value })),
    },
  });

  const { metaobject, userErrors } = data.metaobjectUpsert;
  assertNoUserErrors('metaobjectUpsert', userErrors);
  return metaobject;
}

async function linkToCustomer(customerId, { namespace, key }, entryId) {
  const data = await adminGraphql(CUSTOMER_LINK_SET, {
    metafields: [
      {
        ownerId: customerGid(customerId),
        namespace,
        key,
        type: CUSTOMER_METAFIELD.type,
        value: entryId,
      },
    ],
  });

  assertNoUserErrors('metafieldsSet', data.metafieldsSet.userErrors);
}

export async function saveSubmission({ customerId, ticketNumber, answers, screenshot, target }) {
  const values = {
    ticket_number: ticketNumber,
    yearly_distance_km: String(answers.yearly_distance_km),
    surfaces: JSON.stringify(answers.surfaces),
    goal: answers.goal,
  };

  if (screenshot) {
    values.yearly_distance_screenshot = await uploadImage({
      bytes: screenshot.bytes,
      mimeType: screenshot.mimeType,
      filename: `early-access-yearly-distance-${customerId}.${screenshot.extension}`,
      alt: 'Year-to-date running distance screenshot',
    });
  }

  const entry = await upsertEntry(customerId, target.metaobjectType, values);
  await linkToCustomer(customerId, target.customerMetafield, entry.id);

  return {
    ticketNumber,
    answers,
    screenshotSaved: Boolean(screenshot),
  };
}
