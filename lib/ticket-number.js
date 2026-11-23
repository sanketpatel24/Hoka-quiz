import { adminGraphql } from './shopify.js';

export const TICKET_PREFIX = 'IN-';
export const TICKET_DIGITS = 5;
export const TICKET_NUMBER_REGEX = `^${TICKET_PREFIX}[0-9]{${TICKET_DIGITS}}$`;

const TICKET_MIN = 10 ** (TICKET_DIGITS - 1);
const TICKET_RANGE = 10 ** TICKET_DIGITS - TICKET_MIN;
const MAX_ATTEMPTS = 5;

const TICKET_LOOKUP = `
  query EarlyAccessTicketLookup($type: String!, $query: String!) {
    metaobjects(type: $type, first: 5, query: $query) {
      nodes { ticketNumber: field(key: "ticket_number") { value } }
    }
  }
`;

export function randomTicketNumber() {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return `${TICKET_PREFIX}${TICKET_MIN + (value % TICKET_RANGE)}`;
}

async function isTaken(metaobjectType, ticketNumber) {
  const data = await adminGraphql(TICKET_LOOKUP, {
    type: metaobjectType,
    query: `display_name:"${ticketNumber}"`,
  });
  return data.metaobjects.nodes.some((node) => node.ticketNumber?.value === ticketNumber);
}

export async function issueTicketNumber(metaobjectType) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomTicketNumber();
    if (!(await isTaken(metaobjectType, candidate))) return candidate;
  }
  throw new Error(`no free ticket number after ${MAX_ATTEMPTS} attempts`);
}
