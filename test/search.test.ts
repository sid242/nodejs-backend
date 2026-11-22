import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { searchQueryDto } from '../src/modules/search/search.dto';
import { globalSearch } from '../src/modules/search/search.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Search: searchQueryDto validates query string and parses comma-separated types', () => {
  const valid = searchQueryDto.parse({
    q: '  billing  ',
    limit: '15',
    types: 'pages,actions,members',
  });

  assert.equal(valid.q, 'billing');
  assert.equal(valid.limit, 15);
  assert.deepEqual(valid.types, ['pages', 'actions', 'members']);

  // Empty query rejected
  const emptyRes = searchQueryDto.safeParse({ q: '   ' });
  assert.equal(emptyRes.success, false);
});

test('Search: globalSearch correctly finds matching static pages and actions', async () => {
  const restricted = await globalSearch({ q: 'team', limit: 10 });
  assert.equal(restricted.total, 0);

  const result = await globalSearch({ q: 'team', limit: 10 }, null, [
    'members:read',
    'members:invite',
  ]);

  assert.ok(result.total > 0);
  const titles = result.results.map((r) => r.title);
  assert.ok(titles.includes('Team Members'), 'Should include Team Members page');
  assert.ok(titles.includes('Invite Team Member'), 'Should include Invite Team Member action');
});

test('Search: globalSearch filters strictly by requested category types', async () => {
  const result = await globalSearch({
    q: 'settings',
    limit: 10,
    types: ['actions'], // Only actions
  });

  for (const item of result.results) {
    assert.equal(item.category, 'Actions');
  }
});
