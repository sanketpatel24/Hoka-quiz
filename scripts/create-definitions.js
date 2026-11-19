import { CUSTOMER_METAFIELD, METAOBJECT_DEFINITION } from '../lib/early-access-store.js';
import { readCustomerMetafield, readMetaobjectType } from '../lib/env.js';
import { adminGraphql } from '../lib/shopify.js';

const METAOBJECT_DEFINITION_BY_TYPE = `
  query EarlyAccessMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) { id }
  }
`;

const METAOBJECT_DEFINITION_CREATE = `
  mutation EarlyAccessMetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id }
      userErrors { field message code }
    }
  }
`;

const METAFIELD_DEFINITION_CREATE = `
  mutation EarlyAccessMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const describeErrors = (userErrors) => userErrors.map(({ message }) => message).join('; ');

async function ensureMetaobjectDefinition(type) {
  const existing = await adminGraphql(METAOBJECT_DEFINITION_BY_TYPE, { type });
  if (existing.metaobjectDefinitionByType) {
    return {
      id: existing.metaobjectDefinitionByType.id,
      status: 'already exists - confirm in admin that its fields match the README registry',
    };
  }

  const data = await adminGraphql(METAOBJECT_DEFINITION_CREATE, { definition: { type, ...METAOBJECT_DEFINITION } });
  const { metaobjectDefinition, userErrors } = data.metaobjectDefinitionCreate;
  if (!metaobjectDefinition) throw new Error(describeErrors(userErrors) || 'no definition returned');
  return { id: metaobjectDefinition.id, status: 'created' };
}

async function ensureCustomerMetafieldDefinition({ namespace, key }, metaobjectType, metaobjectDefinitionId) {
  const { type, name, description } = CUSTOMER_METAFIELD;
  const data = await adminGraphql(METAFIELD_DEFINITION_CREATE, {
    definition: {
      ownerType: 'CUSTOMER',
      namespace,
      key,
      type,
      name,
      description,
      validations: [{ name: 'metaobject_definition_id', value: metaobjectDefinitionId }],
      pin: true,
    },
  });

  const { createdDefinition, userErrors } = data.metafieldDefinitionCreate;
  if (createdDefinition) return 'created';
  if (userErrors.length && userErrors.every(({ code }) => code === 'TAKEN')) {
    return `already exists - confirm in admin that it is a ${type} to ${metaobjectType}`;
  }
  throw new Error(describeErrors(userErrors) || 'no definition returned');
}

async function run() {
  let metaobjectType;
  let customerMetafield;
  try {
    metaobjectType = readMetaobjectType();
    customerMetafield = readCustomerMetafield();
  } catch (error) {
    console.error(`configuration: ${error.message}`);
    return 1;
  }

  const metaobjectLabel = `metaobject ${metaobjectType}`;
  const metafieldLabel = `customer metafield ${customerMetafield.namespace}.${customerMetafield.key}`;

  let metaobjectDefinition;
  try {
    metaobjectDefinition = await ensureMetaobjectDefinition(metaobjectType);
    console.log(`${metaobjectLabel}: ${metaobjectDefinition.status}`);
  } catch (error) {
    console.error(`${metaobjectLabel}: failed - ${error.message}`);
    console.error(`${metafieldLabel}: skipped - it needs the metaobject definition`);
    return 1;
  }

  try {
    const status = await ensureCustomerMetafieldDefinition(customerMetafield, metaobjectType, metaobjectDefinition.id);
    console.log(`${metafieldLabel}: ${status}`);
  } catch (error) {
    console.error(`${metafieldLabel}: failed - ${error.message}`);
    return 1;
  }

  return 0;
}

process.exitCode = await run();
