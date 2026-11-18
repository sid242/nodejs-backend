import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

import {
  ALLOWED_TYPES,
  createFolderDto,
  createShareDto,
  listFilesQueryDto,
  requestUploadDto,
  restoreVersionDto,
  updateFileDto,
  updateFolderDto,
} from '@/modules/files/files.dto';
import { safeFilename } from '@/lib/utils';

describe('Phase 06: Files & Storage Architecture Unit Tests', () => {
  describe('1. File DTO & Validation Invariants', () => {
    it('allows permitted MIME types', () => {
      for (const ct of ALLOWED_TYPES) {
        const res = requestUploadDto.safeParse({ filename: 'test-file.doc', contentType: ct });
        assert.equal(res.success, true);
      }
    });

    it('rejects disallowed or malicious MIME types', () => {
      const res = requestUploadDto.safeParse({
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });
      assert.equal(res.success, false);
    });

    it('validates folderId and tags in requestUploadDto', () => {
      const valid = requestUploadDto.parse({
        filename: 'quarterly-report.pdf',
        contentType: 'application/pdf',
        folderId: 'a0000000-0000-0000-0000-000000000001',
        tags: ['finance', '2026', 'q3'],
        description: 'Final signed board deck',
      });
      assert.equal(valid.filename, 'quarterly-report.pdf');
      assert.equal(valid.tags?.length, 3);
      assert.equal(valid.folderId, 'a0000000-0000-0000-0000-000000000001');
    });

    it('rejects invalid UUIDs for folderId', () => {
      const res = requestUploadDto.safeParse({
        filename: 'report.pdf',
        contentType: 'application/pdf',
        folderId: 'not-a-uuid',
      });
      assert.equal(res.success, false);
    });

    it('parses listFilesQueryDto with default values', () => {
      const parsed = listFilesQueryDto.parse({});
      assert.equal(parsed.limit, 50);
      assert.equal(parsed.offset, 0);
      assert.equal(parsed.isDeleted, false);
    });

    it('transforms isDeleted boolean from string query param', () => {
      const parsedTrash = listFilesQueryDto.parse({ isDeleted: 'true' });
      assert.equal(parsedTrash.isDeleted, true);

      const parsedActive = listFilesQueryDto.parse({ isDeleted: 'false' });
      assert.equal(parsedActive.isDeleted, false);
    });
  });

  describe('2. Key Layout & Path Sanitization', () => {
    it('safeFilename sanitizes path traversal characters and preserves extension', () => {
      const dangerous = '../../../../etc/passwd.png';
      const sanitized = safeFilename(dangerous);
      assert.ok(!sanitized.includes('..'));
      assert.ok(!sanitized.includes('/'));
      assert.ok(!sanitized.includes('\\'));
      assert.ok(sanitized.endsWith('.png'));
    });

    it('constructs deterministic structured key layout: tenants/{tenantId}/{yyyy}/{mm}/{fileId}/{sanitizedName}', () => {
      const tenantId = '11111111-2222-3333-4444-555555555555';
      const fileId = 'abcdef01-2345-6789-abcd-ef0123456789';
      const rawName = 'My Quarterly Report (Final) #1.pdf';
      const sanitized = safeFilename(rawName);
      const date = new Date(Date.UTC(2026, 10, 18));
      const yyyy = date.getUTCFullYear().toString();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');

      const key = `tenants/${tenantId}/${yyyy}/${mm}/${fileId}/${sanitized}`;
      assert.equal(
        key,
        'tenants/11111111-2222-3333-4444-555555555555/2026/11/abcdef01-2345-6789-abcd-ef0123456789/My_Quarterly_Report_Final_1.pdf',
      );
    });
  });

  describe('3. Folders Management DTOs', () => {
    it('validates createFolderDto with required name', () => {
      const valid = createFolderDto.parse({
        name: 'Invoices 2026',
        color: '#3B82F6',
        parentId: 'a0000000-0000-0000-0000-000000000001',
      });
      assert.equal(valid.name, 'Invoices 2026');
      assert.equal(valid.color, '#3B82F6');
    });

    it('rejects empty folder name', () => {
      const res = createFolderDto.safeParse({ name: '' });
      assert.equal(res.success, false);
    });

    it('allows partial updates in updateFolderDto', () => {
      const valid = updateFolderDto.parse({ color: '#EF4444' });
      assert.equal(valid.color, '#EF4444');
      assert.equal(valid.name, undefined);
    });
  });

  describe('4. File Sharing & Token Hashing Invariants', () => {
    it('validates createShareDto parameters', () => {
      const valid = createShareDto.parse({
        password: 'secure-password-123',
        maxDownloads: 5,
        expiresInHours: 48,
      });
      assert.equal(valid.maxDownloads, 5);
      assert.equal(valid.expiresInHours, 48);
    });

    it('rejects password shorter than 4 characters', () => {
      const res = createShareDto.safeParse({ password: '123' });
      assert.equal(res.success, false);
    });

    it('hashes raw share tokens using SHA-256 for secure database lookup', () => {
      const rawToken = '5f4dcc3b5aa765d61d8327deb882cf992b321a67b2031efb10e54d8faf665678';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const lookupHash = createHash('sha256').update(rawToken).digest('hex');

      assert.equal(tokenHash, lookupHash);
      assert.equal(tokenHash.length, 64);
    });

    it('validates bcrypt password hash roundtrip for protected shares', async () => {
      const plain = 'confidential-pass-2026';
      const hash = await bcrypt.hash(plain, 10);

      const isMatch = await bcrypt.compare(plain, hash);
      assert.equal(isMatch, true);

      const isWrong = await bcrypt.compare('wrong-password', hash);
      assert.equal(isWrong, false);
    });
  });

  describe('5. Versioning & Update DTOs', () => {
    it('validates restoreVersionDto requiring positive integer', () => {
      const valid = restoreVersionDto.parse({ versionNumber: 2 });
      assert.equal(valid.versionNumber, 2);

      const invalid = restoreVersionDto.safeParse({ versionNumber: 0 });
      assert.equal(invalid.success, false);
    });

    it('validates updateFileDto supporting visibility and metadata changes', () => {
      const valid = updateFileDto.parse({
        filename: 'renamed-doc.pdf',
        description: 'Updated description',
        visibility: 'TENANT',
        tags: ['archived'],
      });
      assert.equal(valid.filename, 'renamed-doc.pdf');
      assert.equal(valid.visibility, 'TENANT');
    });
  });
});
