import { uploadImage } from './files.js';
import { adminGraphql, assertNoUserErrors } from './shopify.js';

const answerField = (key, name, description, type = 'single_line_text_field') => ({
  key,
  name,
  description,
  type,
  required: true,
});

export const METAOBJECT_DEFINITION = {
  name: 'Early Access submission',
  description: 'One entry per customer with the answers from the Early Access quiz popup.',
  displayNameKey: 'pass_number',
  access: { storefront: 'NONE' },
  fieldDefinitions: [
    answerField('pass_number', 'Pass number', 'Early Access pass number shown on the confirmation card.'),
    answerField('weekly_distance', 'Weekly distance', 'Question 1: how far the customer runs in a week.'),
    {
      key: 'run_screenshot',
      name: 'Run screenshot',
      description: 'Question 1: screenshot of a recent run.',
      type: 'file_reference',
      required: false,
      validations: [{ name: 'file_type_options', value: '["Image"]' }],
    },
    answerField('surfaces', 'Running surfaces', 'Question 2: every surface the customer runs on.', 'list.single_line_text_field'),
    answerField('goal', 'Running goal', 'Question 3: what the customer is running towards.'),
    answerField('shoe_fit', 'Shoe fit', "Question 4: men's or women's sizing."),
    answerField('shoe_size', 'Shoe size (UK)', 'Question 4: UK shoe size.'),
    answerField('submitted_at', 'Submitted at', 'When the customer last submitted the quiz.', 'date_time'),
  ],
};

export const CUSTOMER_METAFIELD = {
  type: 'metaobject_reference',
  name: 'Early Access submission',
  description: "The customer's Early Access submission entry.",
};

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

export function passNumberFor(customerId) {
  return BigInt(customerId).toString(36).toUpperCase();
}

function submissionHandleFor(customerId) {
  return `customer-${customerId}`;
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
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace,
        key,
        type: CUSTOMER_METAFIELD.type,
        value: entryId,
      },
    ],
  });

  assertNoUserErrors('metafieldsSet', data.metafieldsSet.userErrors);
}

export async function saveSubmission({ customerId, answers, screenshot, target }) {
  const passNumber = passNumberFor(customerId);
  const submittedAt = new Date().toISOString();

  const values = {
    pass_number: passNumber,
    ...answers,
    surfaces: JSON.stringify(answers.surfaces),
    submitted_at: submittedAt,
  };

  if (screenshot) {
    values.run_screenshot = await uploadImage({
      bytes: screenshot.bytes,
      mimeType: screenshot.mimeType,
      filename: `early-access-run-${customerId}.${screenshot.extension}`,
      alt: 'Recent run screenshot',
    });
  }

  const entry = await upsertEntry(customerId, target.metaobjectType, values);
  await linkToCustomer(customerId, target.customerMetafield, entry.id);

  return {
    passNumber,
    submittedAt,
    answers,
    screenshotSaved: Boolean(screenshot),
  };
}
