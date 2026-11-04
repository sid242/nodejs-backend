import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addMemberDto,
  bulkInviteMembersDto,
  listMembersQueryDto,
  updateMemberDto,
  updateMemberStatusDto,
} from '@/modules/tenants/tenants.dto';
import { createInvitationDto, acceptInvitationDto } from '@/modules/invitations/invitations.dto';
import { publicTenantMember } from '@/db/schema/tenancy/tenant-members';

describe('Phase 04: Tenant Members & Invitations Unit Tests', () => {
  describe('1. listMembersQueryDto validation', () => {
    it('applies standard member list pagination and sort defaults', () => {
      const parsed = listMembersQueryDto.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.sortBy, 'joinedAt');
      assert.equal(parsed.sortOrder, 'desc');
    });

    it('accepts multi-field filtering parameters including REMOVED and department', () => {
      const parsed = listMembersQueryDto.parse({
        page: 2,
        limit: 50,
        search: 'Alice Engineer',
        status: 'REMOVED',
        department: 'Engineering',
        sortBy: 'lastLoginAt',
        sortOrder: 'asc',
      });

      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 50);
      assert.equal(parsed.search, 'Alice Engineer');
      assert.equal(parsed.status, 'REMOVED');
      assert.equal(parsed.department, 'Engineering');
      assert.equal(parsed.sortBy, 'lastLoginAt');
      assert.equal(parsed.sortOrder, 'asc');
    });

    it('rejects invalid member status values', () => {
      assert.throws(() => {
        listMembersQueryDto.parse({ status: 'BANNED' });
      });
    });
  });

  describe('2. addMemberDto and createInvitationDto validation', () => {
    it('successfully parses full rich member invite input with tenant metadata', () => {
      const input = {
        email: 'alice.smith@acme.com',
        role: 'ENGINEER',
        roleId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        firstName: 'Alice',
        lastName: 'Smith',
        phone: '+1-555-0123',
        memberCode: 'MEM-00142',
        jobTitle: 'Senior Systems Architect',
        department: 'Core Infrastructure',
        groupIds: ['b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e'],
        expiresInHours: 72,
        message: 'Welcome to the Core Infrastructure team at Acme!',
      };

      const parsed = addMemberDto.parse(input);
      assert.equal(parsed.email, 'alice.smith@acme.com');
      assert.equal(parsed.role, 'ENGINEER');
      assert.equal(parsed.firstName, 'Alice');
      assert.equal(parsed.lastName, 'Smith');
      assert.equal(parsed.phone, '+1-555-0123');
      assert.equal(parsed.memberCode, 'MEM-00142');
      assert.equal(parsed.jobTitle, 'Senior Systems Architect');
      assert.equal(parsed.department, 'Core Infrastructure');
      assert.equal(parsed.expiresInHours, 72);
      assert.equal(parsed.message, 'Welcome to the Core Infrastructure team at Acme!');
      assert.equal(parsed.groupIds?.length, 1);
    });

    it('applies default role MEMBER and 48-hour expiration for minimal invitation', () => {
      const parsed = addMemberDto.parse({
        email: 'bob.dev@acme.com',
      });

      assert.equal(parsed.email, 'bob.dev@acme.com');
      assert.equal(parsed.role, 'MEMBER');
      assert.equal(parsed.expiresInHours, 48);
    });

    it('rejects invalid email formats', () => {
      assert.throws(() => {
        addMemberDto.parse({ email: 'not-an-email' });
      });
    });

    it('requires either roleId or role in createInvitationDto', () => {
      const validWithRole = createInvitationDto.parse({
        email: 'dev@acme.com',
        role: 'DEVELOPER',
      });
      assert.equal(validWithRole.role, 'DEVELOPER');

      const validWithRoleId = createInvitationDto.parse({
        email: 'dev@acme.com',
        roleId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      });
      assert.equal(validWithRoleId.roleId, 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');

      assert.throws(() => {
        createInvitationDto.parse({ email: 'dev@acme.com' });
      });
    });
  });

  describe('3. bulkInviteMembersDto validation', () => {
    it('accepts an array of invitations with tenant profile fields', () => {
      const parsed = bulkInviteMembersDto.parse({
        invites: [
          { email: 'member1@acme.com', role: 'ENGINEER', department: 'R&D' },
          { email: 'member2@acme.com', role: 'PRODUCT_MANAGER', department: 'Product' },
        ],
      });

      assert.equal(parsed.invites.length, 2);
      assert.equal(parsed.invites[0]?.department, 'R&D');
      assert.equal(parsed.invites[1]?.department, 'Product');
    });

    it('rejects an empty batch or batches exceeding 50 items', () => {
      assert.throws(() => {
        bulkInviteMembersDto.parse({ invites: [] });
      });

      const oversizedBatch = Array.from({ length: 51 }, (_, i) => ({
        email: `user${i}@acme.com`,
        role: 'MEMBER',
      }));

      assert.throws(() => {
        bulkInviteMembersDto.parse({ invites: oversizedBatch });
      });
    });
  });

  describe('4. updateMemberDto & updateMemberStatusDto validation', () => {
    it('allows updating tenant-specific member metadata', () => {
      const parsed = updateMemberDto.parse({
        memberCode: 'CODE-999',
        jobTitle: 'Principal Engineer',
        department: 'Architecture',
        phone: '+1-555-9999',
      });

      assert.equal(parsed.memberCode, 'CODE-999');
      assert.equal(parsed.jobTitle, 'Principal Engineer');
      assert.equal(parsed.department, 'Architecture');
      assert.equal(parsed.phone, '+1-555-9999');
    });

    it('validates member status transitions', () => {
      const active = updateMemberStatusDto.parse({ status: 'ACTIVE' });
      assert.equal(active.status, 'ACTIVE');

      const suspended = updateMemberStatusDto.parse({ status: 'SUSPENDED' });
      assert.equal(suspended.status, 'SUSPENDED');

      assert.throws(() => {
        updateMemberStatusDto.parse({ status: 'UNKNOWN' });
      });
    });
  });

  describe('5. acceptInvitationDto validation', () => {
    it('validates token requirement and optional password for new users', () => {
      const parsed = acceptInvitationDto.parse({
        token: 'secret-invite-token-abc',
        name: 'New User',
        password: 'SecurePassword123!',
      });

      assert.equal(parsed.token, 'secret-invite-token-abc');
      assert.equal(parsed.name, 'New User');
      assert.equal(parsed.password, 'SecurePassword123!');
    });

    it('rejects passwords shorter than 8 characters', () => {
      assert.throws(() => {
        acceptInvitationDto.parse({
          token: 'token-123',
          password: 'short',
        });
      });
    });
  });

  describe('6. publicTenantMember projection safety', () => {
    it('ensures no password or sensitive internal tenant secret references are exposed', () => {
      const fields = Object.keys(publicTenantMember);
      assert.ok(!fields.includes('passwordHash'));
      assert.ok(!fields.includes('databaseSecretRef'));
      assert.ok(fields.includes('id'));
      assert.ok(fields.includes('userId'));
      assert.ok(fields.includes('status'));
      assert.ok(fields.includes('memberCode'));
      assert.ok(fields.includes('phone'));
      assert.ok(fields.includes('jobTitle'));
      assert.ok(fields.includes('department'));
      assert.ok(fields.includes('joinedAt'));
      assert.ok(fields.includes('invitedAt'));
      assert.ok(fields.includes('lastLoginAt'));
    });
  });
});
