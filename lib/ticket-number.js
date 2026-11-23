export const TICKET_PREFIX = 'IN-';
export const TICKET_DIGITS = 5;
export const TICKET_NUMBER_REGEX = `^[A-Z]?${TICKET_PREFIX}[0-9]{${TICKET_DIGITS}}$`;

const INITIAL_PATTERN = /^[A-Z]$/;

function initialOf(name) {
  const initial = (name ?? '').trim().normalize('NFD').charAt(0).toUpperCase();
  return INITIAL_PATTERN.test(initial) ? initial : '';
}

export function ticketNumberFor({ customerId, firstName, lastName }) {
  const initial = initialOf(firstName) || initialOf(lastName);
  const digits = String(customerId).slice(-TICKET_DIGITS).padStart(TICKET_DIGITS, '0');
  return `${initial}${TICKET_PREFIX}${digits}`;
}
