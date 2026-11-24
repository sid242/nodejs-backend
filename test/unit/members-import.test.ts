import assert from 'node:assert/strict';
import test from 'node:test';

import { executeMemberImportDto, validateMemberImportDto } from '@/modules/tenants/tenants.dto';

test('Member Import DTO: validateMemberImportDto', () => {
  const valid = validateMemberImportDto.safeParse({
    rows: [
      {
        email: 'alice@example.com',
        role: 'ADMIN',
        firstName: 'Alice',
        lastName: 'Smith',
        jobTitle: 'VP Engineering',
        department: 'Engineering',
      },
      {
        email: 'bob@example.com',
        role: 'MEMBER',
        managerEmail: 'alice@example.com',
      },
    ],
  });
  assert.equal(valid.success, true);

  const invalidEmail = validateMemberImportDto.safeParse({
    rows: [{ email: 'not-an-email' }],
  });
  assert.equal(invalidEmail.success, false);

  const emptyRows = validateMemberImportDto.safeParse({
    rows: [],
  });
  assert.equal(emptyRows.success, false);
});

test('Member Import DTO: executeMemberImportDto', () => {
  const valid = executeMemberImportDto.safeParse({
    rows: [
      {
        email: 'charlie@example.com',
        role: 'MEMBER',
      },
    ],
    sendInviteEmails: false,
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.sendInviteEmails, false);
  }
});
