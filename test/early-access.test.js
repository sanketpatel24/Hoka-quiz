import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SCREENSHOT_BYTES, MAX_YEARLY_DISTANCE_KM, parseSubmission } from '../lib/early-access.js';
import { TICKET_NUMBER_REGEX, ticketNumberFor } from '../lib/ticket-number.js';
import { PNG_BYTES, validForm } from './helpers.js';

test('parses a complete submission', async () => {
  const { answers, screenshot, errors } = await parseSubmission(validForm());
  assert.equal(errors, null);
  assert.deepEqual(answers, {
    yearly_distance_km: 850.5,
    surfaces: ['road', 'trail'],
    goal: 'half-marathon',
  });
  assert.equal(screenshot.mimeType, 'image/png');
  assert.equal(screenshot.extension, 'png');
});

test('treats an empty file input as no screenshot', async () => {
  const form = validForm({ withScreenshot: false });
  form.set('yearly_distance_screenshot', new File([], '', { type: 'application/octet-stream' }));
  const { screenshot, errors } = await parseSubmission(form);
  assert.equal(errors, null);
  assert.equal(screenshot, null);
});

test('reports every missing answer by field', async () => {
  const { errors } = await parseSubmission(new FormData());
  assert.deepEqual(errors, {
    yearly_distance_km: 'required',
    surfaces: 'required',
    goal: 'required',
  });
});

test('rejects answers that are not handles', async () => {
  const form = validForm();
  form.set('goal', '<script>');
  form.append('surfaces', 'Road Running');
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { goal: 'invalid', surfaces: 'invalid' });
});

test('accepts whole and decimal yearly kilometres from zero to the maximum', async () => {
  const cases = [['0', 0], ['850', 850], ['0850', 850], ['1234.56', 1234.56], [String(MAX_YEARLY_DISTANCE_KM), MAX_YEARLY_DISTANCE_KM]];
  for (const [input, expected] of cases) {
    const form = validForm();
    form.set('yearly_distance_km', input);
    const { answers, errors } = await parseSubmission(form);
    assert.equal(errors, null, input);
    assert.equal(answers.yearly_distance_km, expected, input);
  }
});

test('rejects yearly kilometres that are not a plain number in range', async () => {
  const inputs = ['-5', '850 km', '1,234', '12.345', '1e3', '20000.01', '850.', '.5', 'NaN'];
  for (const input of inputs) {
    const form = validForm();
    form.set('yearly_distance_km', input);
    const { errors } = await parseSubmission(form);
    assert.deepEqual(errors, { yearly_distance_km: 'invalid' }, input);
  }
});

test('removes duplicate surfaces', async () => {
  const form = validForm();
  form.append('surfaces', 'road');
  const { answers } = await parseSubmission(form);
  assert.deepEqual(answers.surfaces, ['road', 'trail']);
});

test('rejects a file that claims to be PNG but is not', async () => {
  const form = validForm();
  form.set('yearly_distance_screenshot', new File(['not an image'], 'run.png', { type: 'image/png' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { yearly_distance_screenshot: 'unsupported_type' });
});

test('rejects file types other than PNG and JPG', async () => {
  const form = validForm();
  form.set('yearly_distance_screenshot', new File(['GIF89a'], 'run.gif', { type: 'image/gif' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { yearly_distance_screenshot: 'unsupported_type' });
});

test('rejects a file type that matches an object property name', async () => {
  const form = validForm();
  form.set('yearly_distance_screenshot', new File([PNG_BYTES], 'run.png', { type: 'constructor' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { yearly_distance_screenshot: 'unsupported_type' });
});

test('rejects a screenshot over 2 MB', async () => {
  const oversized = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
  oversized.set(PNG_BYTES);
  const form = validForm();
  form.set('yearly_distance_screenshot', new File([oversized], 'run.png', { type: 'image/png' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { yearly_distance_screenshot: 'too_large' });
});

test('builds the ticket from the first letter of the first name and the last five digits of the customer ID', () => {
  const pattern = new RegExp(TICKET_NUMBER_REGEX);
  const cases = [
    [{ customerId: '7712345678901', firstName: 'Asha', lastName: 'Rao' }, 'AIN-78901'],
    [{ customerId: '7712345678901', firstName: '  riya ', lastName: 'Shah' }, 'RIN-78901'],
    [{ customerId: '7712345678901', firstName: 'Élodie', lastName: null }, 'EIN-78901'],
    [{ customerId: '7712345678901', firstName: '李', lastName: 'Wong' }, 'WIN-78901'],
    [{ customerId: '7712345678901', firstName: null, lastName: undefined }, 'IN-78901'],
    [{ customerId: '42', firstName: 'Dev', lastName: null }, 'DIN-00042'],
  ];
  for (const [customer, expected] of cases) {
    assert.equal(ticketNumberFor(customer), expected);
    assert.match(expected, pattern);
  }
});

test('accepts tickets issued in the earlier random format', () => {
  assert.match('IN-48213', new RegExp(TICKET_NUMBER_REGEX));
});
