import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderWelcomeEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
} from '../src/templates/emails/index.js';

test('renderWelcomeEmail produces valid subject and includes user name', () => {
  const result = renderWelcomeEmail({ name: 'Alice' });
  assert.equal(result.subject, 'Welcome aboard!');
  assert.ok(result.html.includes('Alice'));
  assert.ok(result.html.includes('<!DOCTYPE html>'));
});

test('renderPasswordResetEmail contains token and reset instructions', () => {
  const result = renderPasswordResetEmail({
    name: 'Bob',
    token: 'test-reset-token-12345',
    resetUrl: 'https://example.com/reset?token=test-reset-token-12345',
  });
  assert.equal(result.subject, 'Reset your password');
  assert.ok(result.html.includes('test-reset-token-12345'));
  assert.ok(result.html.includes('https://example.com/reset?token=test-reset-token-12345'));
  assert.ok(result.html.includes('Bob'));
  assert.ok(result.html.includes('15 minutes'));
});

test('renderVerifyEmail contains verification token and 24 hour expiry', () => {
  const result = renderVerifyEmail({
    name: 'Charlie',
    token: 'verify-token-67890',
  });
  assert.equal(result.subject, 'Verify your email address');
  assert.ok(result.html.includes('verify-token-67890'));
  assert.ok(result.html.includes('Charlie'));
  assert.ok(result.html.includes('24 hours'));
});
