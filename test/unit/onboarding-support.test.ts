import assert from 'node:assert/strict';
import test from 'node:test';

import { updateOnboardingStepDto } from '@/modules/onboarding/onboarding.dto';
import {
  addTicketMessageDto,
  createFeedbackDto,
  createTicketDto,
  updateTicketDto,
} from '@/modules/support/support.dto';

test('Onboarding DTO: updateOnboardingStepDto', () => {
  const valid = updateOnboardingStepDto.safeParse({
    status: 'COMPLETED',
    data: { roleCount: 4 },
  });
  assert.equal(valid.success, true);

  const invalid = updateOnboardingStepDto.safeParse({
    status: 'INVALID_STATUS',
  });
  assert.equal(invalid.success, false);
});

test('Support DTO: createTicketDto & updateTicketDto', () => {
  const valid = createTicketDto.safeParse({
    subject: 'Cannot upload files to storage',
    description: 'Encountered 403 Forbidden when requesting presigned upload URL.',
    category: 'TECHNICAL',
    priority: 'HIGH',
    metadata: { browser: 'Chrome', os: 'Windows 11' },
  });
  assert.equal(valid.success, true);

  const tooShort = createTicketDto.safeParse({
    subject: 'No',
    description: 'Short',
  });
  assert.equal(tooShort.success, false);

  const validUpdate = updateTicketDto.safeParse({
    status: 'RESOLVED',
    priority: 'LOW',
  });
  assert.equal(validUpdate.success, true);
});

test('Support DTO: addTicketMessageDto & createFeedbackDto', () => {
  const validMsg = addTicketMessageDto.safeParse({
    message: 'We have resolved the permissions issue on your tenant.',
  });
  assert.equal(validMsg.success, true);

  const validFeedback = createFeedbackDto.safeParse({
    rating: 5,
    category: 'FEATURE',
    comment: 'The new analytics and reporting dashboard is fantastic!',
  });
  assert.equal(validFeedback.success, true);

  const invalidRating = createFeedbackDto.safeParse({
    rating: 6, // max 5
    comment: 'Too high',
  });
  assert.equal(invalidRating.success, false);
});
