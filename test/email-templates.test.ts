import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderPasswordResetEmail,
  renderStaffCredentialsEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
} from '@/templates/emails/index.js';

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

test('renderStaffCredentialsEmail includes login URL, credentials, and role', () => {
  const result = renderStaffCredentialsEmail({
    name: 'Dave Operator',
    email: 'dave@platform.local',
    password: 'InitialPassword123!',
    roleName: 'Support Specialist',
    loginUrl: 'https://platform.example.com/platform/login',
  });
  assert.ok(result.subject.includes('Access Credentials'));
  assert.ok(result.html.includes('Dave Operator'));
  assert.ok(result.html.includes('dave@platform.local'));
  assert.ok(result.html.includes('InitialPassword123!'));
  assert.ok(result.html.includes('Support Specialist'));
  assert.ok(result.html.includes('https://platform.example.com/platform/login'));
});
