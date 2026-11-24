import assert from 'node:assert/strict';
import test from 'node:test';

import { updateMeDto } from '@/modules/users/users.dto';

test('updateMeDto accepts valid international and Indian phone numbers', () => {
  // Valid Indian mobile (+91)
  const validIndia = updateMeDto.safeParse({
    name: 'Siddharth',
    phoneNumber: '+919876543210',
  });
  assert.equal(validIndia.success, true);
  if (validIndia.success) {
    assert.equal(validIndia.data.phoneNumber, '+919876543210');
  }

  // Valid Indian number with spaces (cleaned by preprocessor)
  const spacedIndia = updateMeDto.safeParse({
    phoneNumber: '+91 98765 43210',
  });
  assert.equal(spacedIndia.success, true);
  if (spacedIndia.success) {
    assert.equal(spacedIndia.data.phoneNumber, '+919876543210');
  }

  // Valid US number (+1)
  const validUs = updateMeDto.safeParse({
    phoneNumber: '+14155552671',
  });
  assert.equal(validUs.success, true);
  if (validUs.success) {
    assert.equal(validUs.data.phoneNumber, '+14155552671');
  }

  // Null (clearing phone number)
  const nullPhone = updateMeDto.safeParse({
    phoneNumber: null,
  });
  assert.equal(nullPhone.success, true);
  if (nullPhone.success) {
    assert.equal(nullPhone.data.phoneNumber, null);
  }

  // Empty string (clearing phone number via input)
  const emptyPhone = updateMeDto.safeParse({
    phoneNumber: '',
  });
  assert.equal(emptyPhone.success, true);
  if (emptyPhone.success) {
    assert.equal(emptyPhone.data.phoneNumber, null);
  }

  // Undefined (only updating name)
  const onlyName = updateMeDto.safeParse({
    name: 'New Name',
  });
  assert.equal(onlyName.success, true);
  if (onlyName.success) {
    assert.equal(onlyName.data.phoneNumber, undefined);
  }

  // Invalid: missing leading +
  const noPlus = updateMeDto.safeParse({
    phoneNumber: '9876543210',
  });
  assert.equal(noPlus.success, false);

  // Invalid: letters or garbage
  const garbage = updateMeDto.safeParse({
    phoneNumber: '+91abcdefghij',
  });
  assert.equal(garbage.success, false);
});
