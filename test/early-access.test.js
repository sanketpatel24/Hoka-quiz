import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SCREENSHOT_BYTES, parseSubmission } from '../lib/early-access.js';
import { passNumberFor } from '../lib/early-access-store.js';
import { PNG_BYTES, validForm } from './helpers.js';

test('parses a complete submission', async () => {
  const { answers, screenshot, errors } = await parseSubmission(validForm());
  assert.equal(errors, null);
  assert.deepEqual(answers, {
    weekly_distance: '10-25-km',
    surfaces: ['road', 'trail'],
    goal: 'half-marathon',
    shoe_fit: 'mens',
    shoe_size: '9',
  });
  assert.equal(screenshot.mimeType, 'image/png');
  assert.equal(screenshot.extension, 'png');
});

test('treats an empty file input as no screenshot', async () => {
  const form = validForm({ withScreenshot: false });
  form.set('run_screenshot', new File([], '', { type: 'application/octet-stream' }));
  const { screenshot, errors } = await parseSubmission(form);
  assert.equal(errors, null);
  assert.equal(screenshot, null);
});

test('reports every missing answer by field', async () => {
  const { errors } = await parseSubmission(new FormData());
  assert.deepEqual(errors, {
    weekly_distance: 'required',
    surfaces: 'required',
    goal: 'required',
    shoe_fit: 'required',
    shoe_size: 'required',
  });
});

test('rejects answers that are not handles and sizes that are not UK sizes', async () => {
  const form = validForm();
  form.set('goal', '<script>');
  form.set('shoe_size', '9.25');
  form.append('surfaces', 'Road Running');
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { goal: 'invalid', shoe_size: 'invalid', surfaces: 'invalid' });
});

test('removes duplicate surfaces', async () => {
  const form = validForm();
  form.append('surfaces', 'road');
  const { answers } = await parseSubmission(form);
  assert.deepEqual(answers.surfaces, ['road', 'trail']);
});

test('rejects a file that claims to be PNG but is not', async () => {
  const form = validForm();
  form.set('run_screenshot', new File(['not an image'], 'run.png', { type: 'image/png' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { run_screenshot: 'unsupported_type' });
});

test('rejects file types other than PNG and JPG', async () => {
  const form = validForm();
  form.set('run_screenshot', new File(['GIF89a'], 'run.gif', { type: 'image/gif' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { run_screenshot: 'unsupported_type' });
});

test('rejects a file type that matches an object property name', async () => {
  const form = validForm();
  form.set('run_screenshot', new File([PNG_BYTES], 'run.png', { type: 'constructor' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { run_screenshot: 'unsupported_type' });
});

test('rejects a screenshot over 2 MB', async () => {
  const oversized = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
  oversized.set(PNG_BYTES);
  const form = validForm();
  form.set('run_screenshot', new File([oversized], 'run.png', { type: 'image/png' }));
  const { errors } = await parseSubmission(form);
  assert.deepEqual(errors, { run_screenshot: 'too_large' });
});

test('derives a stable pass number from the customer id', () => {
  assert.equal(passNumberFor('7712345678901'), passNumberFor('7712345678901'));
  assert.notEqual(passNumberFor('7712345678901'), passNumberFor('7712345678902'));
  assert.match(passNumberFor('7712345678901'), /^[0-9A-Z]+$/);
});
