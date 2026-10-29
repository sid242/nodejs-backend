import assert from 'node:assert/strict';
import test from 'node:test';

import { AppResponse } from '@/lib/responses';
import { forEachConcurrent, generateSlug, parseList, safeFilename, slugify } from '@/lib/utils';

test('safeFilename removes slashes and spaces (no path traversal in S3 keys)', () => {
  const out = safeFilename('../../etc/pass wd.png');
  assert.ok(!/[\\/ ]/.test(out));
  assert.ok(out.endsWith('wd.png'));
});

test('safeFilename caps length', () => {
  assert.ok(safeFilename('x'.repeat(500) + '.png').length <= 100);
});

test('parseList trims and drops empties', () => {
  assert.deepEqual(parseList(' a, b ,,c '), ['a', 'b', 'c']);
});

test('forEachConcurrent caps active work and processes every item', async () => {
  let active = 0;
  let peak = 0;
  const processed: number[] = [];

  await forEachConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    processed.push(item);
    active -= 1;
  });

  assert.equal(peak, 2);
  assert.deepEqual(processed.sort(), [1, 2, 3, 4, 5]);
});

test('AppResponse creates a consistent success envelope', () => {
  const response = AppResponse.created({ id: 'user-1' }, 'Registered', { page: 1 });
  assert.deepEqual(response.toJSON('request-1'), {
    success: true,
    message: 'Registered',
    data: { id: 'user-1' },
    meta: { page: 1 },
    requestId: 'request-1',
  });
});

test('generateSlug formats strings into URL-safe slugs correctly', () => {
  assert.equal(generateSlug('Acme Corporation'), 'acme-corporation');
  assert.equal(generateSlug('Docs / API Guides'), 'docs-api-guides');
  assert.equal(generateSlug('---Hello   World---'), 'hello-world');
  assert.equal(generateSlug('Special @#$ Characters!'), 'special-characters');
  assert.equal(generateSlug('Nested / Category - Subcategory'), 'nested-category-subcategory');
  assert.equal(generateSlug(''), '');
  assert.equal(generateSlug(null as unknown as string), '');
  assert.equal(generateSlug(undefined as unknown as string), '');
  assert.equal(slugify('Slugify Alias'), 'slugify-alias');
});
