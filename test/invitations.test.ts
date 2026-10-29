import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import * as invitationsDto from '../src/modules/invitations/invitations.dto';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('createInvitationDto validates email and roleId', () => {
  const valid = invitationsDto.createInvitationDto.safeParse({
    email: 'Colleague@example.com',
    roleId: randomUUID(),
  });
  assert.ok(valid.success);

  const invalidEmail = invitationsDto.createInvitationDto.safeParse({
    email: 'not-an-email',
    roleId: randomUUID(),
  });
  assert.equal(invalidEmail.success, false);
});

test('acceptInvitationDto validates token, password and optional name', () => {
  const valid = invitationsDto.acceptInvitationDto.safeParse({
    token: 'some-random-invite-token-xyz',
    name: 'New Teammate',
    password: 'Password@12345',
  });
  assert.ok(valid.success);

  const missingToken = invitationsDto.acceptInvitationDto.safeParse({
    password: 'Password@12345',
  });
  assert.equal(missingToken.success, false);
});

test('previewInvitation preview query validation', () => {
  const valid = invitationsDto.previewInvitationQueryDto.safeParse({
    token: 'valid-token-string',
  });
  assert.ok(valid.success);

  const empty = invitationsDto.previewInvitationQueryDto.safeParse({
    token: '',
  });
  assert.equal(empty.success, false);
});
