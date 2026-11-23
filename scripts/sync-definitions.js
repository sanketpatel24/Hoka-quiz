import { planDefinitionUpdate } from '../lib/definition-sync.js';
import { CUSTOMER_METAFIELD, METAOBJECT_DEFINITION } from '../lib/early-access-store.js';
import { readCustomerMetafield, readMetaobjectType } from '../lib/env.js';
import { adminGraphql } from '../lib/shopify.js';

const PRUNE_FLAG = '--prune';

const METAOBJECT_DEFINITION_BY_TYPE = `
  query EarlyAccessMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      displayNameKey
      fieldDefinitions { key type { name } }
    }
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

const METAOBJECT_DEFINITION_UPDATE = `
  mutation EarlyAccessMetaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
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

async function createMetaobjectDefinition(type) {
  const data = await adminGraphql(METAOBJECT_DEFINITION_CREATE, { definition: { type, ...METAOBJECT_DEFINITION } });
  const { metaobjectDefinition, userErrors } = data.metaobjectDefinitionCreate;
  if (!metaobjectDefinition) throw new Error(describeErrors(userErrors) || 'no definition returned');
  return { id: metaobjectDefinition.id, report: ['created with every field'] };
}

async function updateMetaobjectDefinition(existing, prune) {
  const { definition, report, conflicts } = planDefinitionUpdate(existing, METAOBJECT_DEFINITION, { prune });
  if (conflicts.length) {
    throw new Error(`fields with the wrong type, nothing changed: ${conflicts.join('; ')}. Delete them in admin, then run again`);
  }

  const data = await adminGraphql(METAOBJECT_DEFINITION_UPDATE, { id: existing.id, definition });
  const { metaobjectDefinition, userErrors } = data.metaobjectDefinitionUpdate;
  if (!metaobjectDefinition) throw new Error(describeErrors(userErrors) || 'no definition returned');
  return { id: metaobjectDefinition.id, report };
}

async function syncMetaobjectDefinition(type, prune) {
  const { metaobjectDefinitionByType: existing } = await adminGraphql(METAOBJECT_DEFINITION_BY_TYPE, { type });
  return existing ? updateMetaobjectDefinition(existing, prune) : createMetaobjectDefinition(type);
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
  const prune = process.argv.slice(2).includes(PRUNE_FLAG);

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
    metaobjectDefinition = await syncMetaobjectDefinition(metaobjectType, prune);
    for (const line of metaobjectDefinition.report) console.log(`${metaobjectLabel}: ${line}`);
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
