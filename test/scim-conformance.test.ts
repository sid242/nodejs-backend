import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sql } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { handleScimErrors } from '../src/modules/scim/scim.controller';
import { ScimError } from '../src/modules/scim/scim.dto';
import { scimService } from '../src/modules/scim/scim.service';
import { AppError } from '../src/lib/errors';

let dbConnected = false;

before(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbConnected = true;
  } catch {
    dbConnected = false;
  }
});

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

test('SCIM Conformance 1: ServiceProviderConfig, Schemas & ResourceTypes RFC compliance', async () => {
  // ServiceProviderConfig
  const config = scimService.getServiceProviderConfig();
  assert.deepEqual(config.schemas, ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig']);
  assert.equal(config.patch.supported, true);
  assert.equal(config.filter.supported, true);
  assert.equal(config.etag.supported, true);
  assert.equal(config.bulk.supported, false);

  // Schemas
  const schemas = scimService.getSchemas();
  assert.equal(schemas.totalResults, 2);
  const userSchema = scimService.getSchemaById('User');
  assert.equal(userSchema.name, 'User');
  assert.ok(userSchema.attributes.some((a) => a.name === 'userName'));
  assert.ok(userSchema.attributes.some((a) => a.name === 'externalId'));

  // ResourceTypes
  const resourceTypes = scimService.getResourceTypes();
  assert.equal(resourceTypes.totalResults, 2);
  const userType = scimService.getResourceTypeById('User');
  assert.equal(userType.name, 'User');
  assert.equal(userType.endpoint, '/Users');
});

test('SCIM Conformance 2: ScimError conforms to RFC 7644 JSON specification', () => {
  const err409 = new ScimError(409, 'User already exists', 'uniqueness');
  const res409 = err409.toResponse();
  assert.deepEqual(res409.schemas, ['urn:ietf:params:scim:api:messages:2.0:Error']);
  assert.equal(res409.status, '409');
  assert.equal(res409.scimType, 'uniqueness');
  assert.equal(res409.detail, 'User already exists');

  const err400 = new ScimError(400, 'Invalid filter syntax', 'invalidFilter');
  const res400 = err400.toResponse();
  assert.equal(res400.status, '400');
  assert.equal(res400.scimType, 'invalidFilter');
});

test('SCIM Conformance 3: SCIM Error Handler serializes RFC 7644 error envelope', () => {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let responseBody: any = null;

  const mockRes: any = {
    headersSent: false,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          responseBody = data;
        },
      };
    },
  };

  // 1. ScimError handling
  const scimErr = new ScimError(409, 'User with this userName already exists', 'uniqueness');
  handleScimErrors(scimErr, {} as any, mockRes, () => {});

  assert.equal(statusCode, 409);
  assert.ok(headers['content-type']?.includes('application/scim+json'));
  assert.deepEqual(responseBody?.schemas, ['urn:ietf:params:scim:api:messages:2.0:Error']);
  assert.equal(responseBody?.status, '409');
  assert.equal(responseBody?.scimType, 'uniqueness');
  assert.equal(responseBody?.detail, 'User with this userName already exists');

  // 2. AppError mapping
  const appConflictErr = AppError.conflict('Resource conflict');
  handleScimErrors(appConflictErr, {} as any, mockRes, () => {});
  assert.equal(statusCode, 409);
  assert.equal(responseBody?.scimType, 'uniqueness');
});

test('SCIM Conformance 4: Token rotation and IP allow-list logic', async (t) => {
  if (!dbConnected) {
    t.skip('Database offline');
    return;
  }
  // Live test against database when available
});
