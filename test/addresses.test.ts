import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '@/config/db';
import { GEO_LEVEL } from '@/db/geo';
import { AppError } from '@/lib/errors';
import { addressBodyDto } from '@/modules/addresses/addresses.dto';
import { addressRepo } from '@/modules/addresses/addresses.repository';
import type { OwnerScope } from '@/modules/addresses/addresses.repository';
import * as addressService from '@/modules/addresses/addresses.service';
import { geoRepo } from '@/modules/geo/geo.repository';

test('addressBodyDto validates Indian and international addresses', () => {
  // Valid India address
  const validIn = addressBodyDto.safeParse({
    line1: '123 MG Road',
    countryCode: 'IN',
    postalCode: '380006',
    stateGeoId: 24,
  });
  assert.equal(validIn.success, true);

  // Invalid PIN code for India
  const badPin = addressBodyDto.safeParse({
    line1: '123 MG Road',
    countryCode: 'IN',
    postalCode: '012345', // Starts with 0
    stateGeoId: 24,
  });
  assert.equal(badPin.success, false);

  const shortPin = addressBodyDto.safeParse({
    line1: '123 MG Road',
    countryCode: 'IN',
    postalCode: '38001', // 5 digits
    stateGeoId: 24,
  });
  assert.equal(shortPin.success, false);

  // Missing stateGeoId for India
  const missingState = addressBodyDto.safeParse({
    line1: '123 MG Road',
    countryCode: 'IN',
    postalCode: '380006',
  });
  assert.equal(missingState.success, false);

  // Non-India address with free text
  const validUs = addressBodyDto.safeParse({
    line1: '1600 Amphitheatre Pkwy',
    countryCode: 'US',
    postalCode: '94043',
    stateName: 'California',
    localityName: 'Mountain View',
  });
  assert.equal(validUs.success, true);

  // Non-India address with India geo ids must be rejected
  const badUsWithGeo = addressBodyDto.safeParse({
    line1: '1600 Amphitheatre Pkwy',
    countryCode: 'US',
    stateGeoId: 24,
  });
  assert.equal(badUsWithGeo.success, false);
});

test('resolveGeo validates hierarchical consistency and PIN containment', async () => {
  // Setup mock data in geoRepo
  const origFindByIds = geoRepo.findByIds;
  const origFindByPin = geoRepo.findByPinCode;
  const origStateIdOf = geoRepo.stateIdOf;

  const mockEntities: Record<number, any> = {
    // State 24: Gujarat
    24: { id: 24, levelId: GEO_LEVEL.STATE, parentId: 1, name: 'Gujarat', isActive: true },
    // State 27: Maharashtra
    27: { id: 27, levelId: GEO_LEVEL.STATE, parentId: 1, name: 'Maharashtra', isActive: true },
    // District 440: Ahmedabad (Gujarat)
    440: { id: 440, levelId: GEO_LEVEL.DISTRICT, parentId: 24, name: 'Ahmedabad', isActive: true },
    // District 500: Pune (Maharashtra)
    500: { id: 500, levelId: GEO_LEVEL.DISTRICT, parentId: 27, name: 'Pune', isActive: true },
    // Sub-district 3500: Sabarmati (Ahmedabad)
    3500: { id: 3500, levelId: GEO_LEVEL.SUBDISTRICT, parentId: 440, name: 'Sabarmati', isActive: true },
    // Sub-district 3600: Haveli (Pune)
    3600: { id: 3600, levelId: GEO_LEVEL.SUBDISTRICT, parentId: 500, name: 'Haveli', isActive: true },
    // City 10001: Ahmedabad City (under district 440)
    10001: { id: 10001, levelId: GEO_LEVEL.CITY, parentId: 440, name: 'Ahmedabad City', isActive: true },
    // Village 20001: Chandkheda (under sub-district 3500)
    20001: { id: 20001, levelId: GEO_LEVEL.VILLAGE, parentId: 3500, name: 'Chandkheda', isActive: true },
  };

  (geoRepo as any).findByIds = async (ids: number[]) => {
    return ids.map((id) => mockEntities[id]).filter(Boolean);
  };

  (geoRepo as any).findByPinCode = async (pin: string) => {
    if (pin === '380006') {
      return { id: 99001, levelId: GEO_LEVEL.AREA, name: '380006', isActive: true };
    }
    if (pin === '411001') {
      return { id: 99002, levelId: GEO_LEVEL.AREA, name: '411001', isActive: true };
    }
    return null;
  };

  (geoRepo as any).stateIdOf = async (id: number) => {
    if (id === 99001) return 24; // Gujarat
    if (id === 99002) return 27; // Maharashtra
    return null;
  };

  try {
    // 1. Success valid chain
    const validResult = await addressService.resolveGeo({
      countryCode: 'IN',
      postalCode: '380006',
      stateGeoId: 24,
      districtGeoId: 440,
      subdistrictGeoId: 3500,
      localityKind: 'VILLAGE',
      localityGeoId: 20001,
      line1: 'Plot 42',
    });

    assert.equal(validResult.stateGeoId, 24);
    assert.equal(validResult.stateName, 'Gujarat');
    assert.equal(validResult.districtGeoId, 440);
    assert.equal(validResult.districtName, 'Ahmedabad');
    assert.equal(validResult.subdistrictGeoId, 3500);
    assert.equal(validResult.localityGeoId, 20001);
    assert.equal(validResult.areaGeoId, 99001);

    // 2. District from wrong state
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '380006',
          stateGeoId: 24, // Gujarat
          districtGeoId: 500, // Pune (Maharashtra)
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('District is not in the selected state');
      },
    );

    // 3. Sub-district from wrong district
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '380006',
          stateGeoId: 24,
          districtGeoId: 440, // Ahmedabad
          subdistrictGeoId: 3600, // Haveli (Pune)
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('Sub-district is not in the selected district');
      },
    );

    // 4. Village from wrong subdistrict
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '380006',
          stateGeoId: 24,
          districtGeoId: 440,
          subdistrictGeoId: 3500,
          localityKind: 'VILLAGE',
          localityGeoId: 10001, // City instead of village
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('Invalid location selection');
      },
    );

    // 5. PIN code from a different state
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '411001', // Pune PIN (Maharashtra)
          stateGeoId: 24, // Gujarat
          districtGeoId: 440,
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('PIN code does not belong to the selected state');
      },
    );

    // 6. Non-India with geo id throws bad request
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'US',
          stateGeoId: 24,
          line1: '123 Market St',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('Location ids are only valid for India');
      },
    );

    // 7. City without district
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '380006',
          stateGeoId: 24,
          localityKind: 'CITY',
          localityGeoId: 10001,
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('District is required when city is provided');
      },
    );

    // 8. Locality geo ID without localityKind
    await assert.rejects(
      async () => {
        await addressService.resolveGeo({
          countryCode: 'IN',
          postalCode: '380006',
          stateGeoId: 24,
          districtGeoId: 440,
          localityGeoId: 10001,
          line1: 'Plot 42',
        });
      },
      (err: any) => {
        return err instanceof AppError && err.message.includes('localityKind must be CITY or VILLAGE');
      },
    );
  } finally {
    // Restore original functions
    (geoRepo as any).findByIds = origFindByIds;
    (geoRepo as any).findByPinCode = origFindByPin;
    (geoRepo as any).stateIdOf = origStateIdOf;
  }
});

test('Address owner scoping and isolation returns 404 on cross-scope access', async () => {
  const origFindById = (addressRepo as any).findById;
  const origDbTransaction = (db as any).transaction;

  (db as any).transaction = async (callback: any) => {
    const mockTx = {
      execute: async () => {},
    };
    return callback(mockTx);
  };

  const mockDbAddresses: Record<string, any> = {
    'addr-user-1': {
      id: 'addr-user-1',
      ownerType: 'USER',
      ownerId: 'user-1',
      tenantId: null,
      line1: '123 Main St',
      type: 'HOME',
      isDefault: true,
    },
    'addr-tenant-a': {
      id: 'addr-tenant-a',
      ownerType: 'TENANT',
      ownerId: 'tenant-a',
      tenantId: 'tenant-a',
      line1: 'Building A, Tech Park',
      type: 'WORK',
      isDefault: true,
    },
  };

  (addressRepo as any).findById = async (id: string, scope: OwnerScope) => {
    const record = mockDbAddresses[id];
    if (!record) return null;
    if (record.ownerType !== scope.ownerType) return null;
    if (record.ownerId !== scope.ownerId) return null;
    if (record.tenantId !== (scope.tenantId ?? null)) return null;
    return record;
  };

  try {
    // 1. User 1 can access their address
    const userAddr = await addressService.getAddressById('addr-user-1', {
      ownerType: 'USER',
      ownerId: 'user-1',
      tenantId: null,
    });
    assert.equal(userAddr.id, 'addr-user-1');

    // 2. User 2 trying to access User 1 address -> 404
    await assert.rejects(
      async () => {
        await addressService.getAddressById('addr-user-1', {
          ownerType: 'USER',
          ownerId: 'user-2',
          tenantId: null,
        });
      },
      (err: any) => err instanceof AppError && err.status === 404,
    );

    // 3. Tenant Admin from Tenant B trying to access Tenant A address -> 404
    await assert.rejects(
      async () => {
        await addressService.getAddressById('addr-tenant-a', {
          ownerType: 'TENANT',
          ownerId: 'tenant-b',
          tenantId: 'tenant-b',
        });
      },
      (err: any) => err instanceof AppError && err.status === 404,
    );

    // 4. Tenant Admin trying to access User 1 personal address in tenant context -> 404
    await assert.rejects(
      async () => {
        await addressService.getAddressById('addr-user-1', {
          ownerType: 'TENANT',
          ownerId: 'tenant-a',
          tenantId: 'tenant-a',
        });
      },
      (err: any) => err instanceof AppError && err.status === 404,
    );
  } finally {
    (addressRepo as any).findById = origFindById;
    (db as any).transaction = origDbTransaction;
  }
});

test('Setting a default address clears the previous default for the same type', async () => {
  const origFindById = (addressRepo as any).findById;
  const origClearDefault = (addressRepo as any).clearDefaultForOwnerAndType;
  const origUpdateAddress = (addressRepo as any).updateAddress;
  const origDbTransaction = (db as any).transaction;
  const origDbInsert = (db as any).insert;

  (db as any).insert = () => ({
    values: () => ({
      returning: async () => [{ id: 'mock-audit' }],
    }),
  });

  (db as any).transaction = async (callback: any) => {
    return callback({ execute: async () => {} });
  };

  let clearedType: string | null = null;
  let updatedIsDefault: boolean | null = null;

  (addressRepo as any).findById = async () => ({
    id: 'addr-1',
    ownerType: 'USER',
    ownerId: 'user-1',
    tenantId: null,
    type: 'HOME',
    isDefault: false,
  });

  (addressRepo as any).clearDefaultForOwnerAndType = async (
    _scope: OwnerScope,
    type: string,
  ) => {
    clearedType = type;
  };

  (addressRepo as any).updateAddress = async (
    _id: string,
    data: any,
  ) => {
    updatedIsDefault = data.isDefault;
    return {
      id: 'addr-1',
      ownerType: 'USER',
      ownerId: 'user-1',
      tenantId: null,
      type: 'HOME',
      isDefault: true,
    };
  };

  try {
    const res = await addressService.setDefaultAddress(
      'addr-1',
      { ownerType: 'USER', ownerId: 'user-1', tenantId: null },
      'user-1',
    );

    assert.equal(clearedType, 'HOME');
    assert.equal(updatedIsDefault, true);
    assert.equal(res.isDefault, true);
  } finally {
    (addressRepo as any).findById = origFindById;
    (addressRepo as any).clearDefaultForOwnerAndType = origClearDefault;
    (addressRepo as any).updateAddress = origUpdateAddress;
    (db as any).transaction = origDbTransaction;
    (db as any).insert = origDbInsert;
  }
});
