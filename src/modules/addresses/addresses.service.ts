import { db, type DbExecutor } from '@/config/db';
import { GEO_LEVEL } from '@/db/geo';
import { type Address, type NewAddress } from '@/db/schema/index';
import { withTenantTransaction } from '@/db/tenancy/rls';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { geoRepo } from '@/modules/geo/geo.repository';
import type { AddressBody, AddressPatch } from './addresses.dto';
import { addressRepo } from './addresses.repository';
import type { OwnerScope } from './addresses.repository';

export async function resolveGeo(input: AddressBody | AddressPatch, isPatch = false) {
  const countryCode = input.countryCode ?? (isPatch ? undefined : 'IN');

  const hasAnyGeoId =
    input.stateGeoId !== undefined ||
    input.districtGeoId !== undefined ||
    input.subdistrictGeoId !== undefined ||
    input.localityGeoId !== undefined ||
    input.areaGeoId !== undefined;

  if (countryCode && countryCode !== 'IN') {
    if (hasAnyGeoId) {
      throw AppError.badRequest('Location ids are only valid for India');
    }
    return {
      stateGeoId: null,
      districtGeoId: null,
      subdistrictGeoId: null,
      localityGeoId: null,
      localityKind: null,
      areaGeoId: null,
      stateName: input.stateName ?? null,
      districtName: input.districtName ?? null,
      subdistrictName: input.subdistrictName ?? null,
      localityName: input.localityName ?? null,
      areaName: input.areaName ?? null,
    };
  }

  if (countryCode === 'IN' || (!countryCode && hasAnyGeoId)) {
    if (!isPatch && !input.stateGeoId) {
      throw AppError.badRequest('State is required');
    }

    const idsToFetch = [
      input.stateGeoId,
      input.districtGeoId,
      input.subdistrictGeoId,
      input.localityGeoId,
    ].filter((id): id is number => typeof id === 'number' && id > 0);

    const geoRows = await geoRepo.findByIds(idsToFetch);
    const rowsMap = new Map(geoRows.map((r) => [r.id, r]));

    const pick = (id: number | undefined, expectedLevel: number, fieldName: string) => {
      if (!id) return undefined;
      const r = rowsMap.get(id);
      if (!r || r.levelId !== expectedLevel || !r.isActive) {
        throw AppError.badRequest('Invalid location selection', { field: fieldName });
      }
      return r;
    };

    const state = pick(input.stateGeoId, GEO_LEVEL.STATE, 'stateGeoId');
    const district = pick(input.districtGeoId, GEO_LEVEL.DISTRICT, 'districtGeoId');
    if (district && state && district.parentId !== state.id) {
      throw AppError.badRequest('District is not in the selected state');
    }

    const sub = pick(input.subdistrictGeoId, GEO_LEVEL.SUBDISTRICT, 'subdistrictGeoId');
    if (sub) {
      if (!district) {
        throw AppError.badRequest('District is required when sub-district is provided');
      }
      if (sub.parentId !== district.id) {
        throw AppError.badRequest('Sub-district is not in the selected district');
      }
    }

    let locality: any;
    if (input.localityGeoId) {
      if (input.localityKind === 'CITY') {
        if (!district) {
          throw AppError.badRequest('District is required when city is provided');
        }
        locality = pick(input.localityGeoId, GEO_LEVEL.CITY, 'localityGeoId');
        if (locality && locality.parentId !== district.id) {
          throw AppError.badRequest('City is not in the selected district');
        }
      } else if (input.localityKind === 'VILLAGE') {
        if (!sub) {
          throw AppError.badRequest('Sub-district is required when village is provided');
        }
        locality = pick(input.localityGeoId, GEO_LEVEL.VILLAGE, 'localityGeoId');
        if (locality && locality.parentId !== sub.id) {
          throw AppError.badRequest('Village is not in the selected sub-district');
        }
      } else {
        throw AppError.badRequest('localityKind must be CITY or VILLAGE when localityGeoId is provided');
      }
    }

    // PIN area lookup
    let pinArea: any = null;
    if (input.postalCode) {
      pinArea = await geoRepo.findByPinCode(input.postalCode);
      if (pinArea && state) {
        const pinStateId = await geoRepo.stateIdOf(pinArea.id);
        if (pinStateId && pinStateId !== state.id) {
          throw AppError.badRequest('PIN code does not belong to the selected state');
        }
      }
    }

    return {
      ...(state ? { stateGeoId: state.id, stateName: state.name } : {}),
      ...(district !== undefined
        ? { districtGeoId: district ? district.id : null, districtName: district ? district.name : null }
        : {}),
      ...(sub !== undefined
        ? { subdistrictGeoId: sub ? sub.id : null, subdistrictName: sub ? sub.name : null }
        : {}),
      ...(locality !== undefined
        ? {
            localityGeoId: locality ? locality.id : null,
            localityName: locality ? locality.name : null,
            localityKind: input.localityKind ?? null,
          }
        : {}),
      ...(pinArea ? { areaGeoId: pinArea.id, areaName: pinArea.name } : {}),
    };
  }

  return {};
}

function executeWithScope<T>(
  scope: OwnerScope,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  if (scope.tenantId) {
    return withTenantTransaction(scope.tenantId, fn);
  }
  return db.transaction(fn);
}

export async function listAddresses(scope: OwnerScope): Promise<Address[]> {
  return executeWithScope(scope, async (tx) => {
    return addressRepo.findManyByOwner(scope, tx);
  });
}

export async function getAddressById(id: string, scope: OwnerScope): Promise<Address> {
  const address = await executeWithScope(scope, async (tx) => {
    return addressRepo.findById(id, scope, tx);
  });

  if (!address) {
    throw AppError.notFound('Address not found');
  }

  return address;
}

export async function createAddress(
  scope: OwnerScope,
  input: AddressBody,
  userId: string,
): Promise<Address> {
  const geoResolved = await resolveGeo(input, false);

  const newAddressData: NewAddress = {
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
    tenantId: scope.tenantId ?? null,
    type: input.type,
    label: input.label ?? null,
    isDefault: input.isDefault ?? false,
    recipientName: input.recipientName ?? null,
    phone: input.phone ?? null,
    line1: input.line1,
    line2: input.line2 ?? null,
    landmark: input.landmark ?? null,
    postalCode: input.postalCode ?? null,
    countryCode: input.countryCode ?? 'IN',
    stateGeoId: geoResolved.stateGeoId ?? null,
    districtGeoId: geoResolved.districtGeoId ?? null,
    subdistrictGeoId: geoResolved.subdistrictGeoId ?? null,
    localityGeoId: geoResolved.localityGeoId ?? null,
    localityKind: geoResolved.localityKind ?? null,
    areaGeoId: geoResolved.areaGeoId ?? null,
    stateName: geoResolved.stateName ?? input.stateName ?? null,
    districtName: geoResolved.districtName ?? input.districtName ?? null,
    subdistrictName: geoResolved.subdistrictName ?? input.subdistrictName ?? null,
    localityName: geoResolved.localityName ?? input.localityName ?? null,
    areaName: geoResolved.areaName ?? input.areaName ?? null,
    latitude: input.latitude !== undefined ? String(input.latitude) : null,
    longitude: input.longitude !== undefined ? String(input.longitude) : null,
  };

  const created = await executeWithScope(scope, async (tx) => {
    if (newAddressData.isDefault) {
      await addressRepo.clearDefaultForOwnerAndType(scope, newAddressData.type ?? 'OTHER', tx);
    }
    return addressRepo.createAddress(newAddressData, tx);
  });

  await logSecurityEvent({
    action: 'ADDRESS.CREATED',
    entityType: 'Address',
    entityId: created.id,
    tenantId: scope.tenantId ?? undefined,
    userId,
    metadata: { ownerType: scope.ownerType },
  });

  return created;
}

export async function updateAddress(
  id: string,
  scope: OwnerScope,
  patch: AddressPatch,
  userId: string,
): Promise<Address> {
  const existing = await addressRepo.findById(id, scope);
  if (!existing) {
    throw AppError.notFound('Address not found');
  }

  const geoResolved = await resolveGeo(
    {
      ...patch,
      countryCode: patch.countryCode ?? existing.countryCode,
      postalCode: patch.postalCode ?? existing.postalCode ?? undefined,
      stateGeoId: patch.stateGeoId ?? existing.stateGeoId ?? undefined,
      districtGeoId: patch.districtGeoId ?? existing.districtGeoId ?? undefined,
      subdistrictGeoId: patch.subdistrictGeoId ?? existing.subdistrictGeoId ?? undefined,
    },
    true,
  );

  const updateData: Partial<NewAddress> = {
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.recipientName !== undefined ? { recipientName: patch.recipientName } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.line1 !== undefined ? { line1: patch.line1 } : {}),
    ...(patch.line2 !== undefined ? { line2: patch.line2 } : {}),
    ...(patch.landmark !== undefined ? { landmark: patch.landmark } : {}),
    ...(patch.postalCode !== undefined ? { postalCode: patch.postalCode } : {}),
    ...(patch.countryCode !== undefined ? { countryCode: patch.countryCode } : {}),
    ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
    ...(patch.latitude !== undefined ? { latitude: String(patch.latitude) } : {}),
    ...(patch.longitude !== undefined ? { longitude: String(patch.longitude) } : {}),
    ...geoResolved,
  };

  const targetType = patch.type ?? existing.type;

  const updated = await executeWithScope(scope, async (tx) => {
    if (patch.isDefault) {
      await addressRepo.clearDefaultForOwnerAndType(scope, targetType, tx);
    }
    return addressRepo.updateAddress(id, updateData, tx);
  });

  if (!updated) {
    throw AppError.notFound('Address not found');
  }

  await logSecurityEvent({
    action: 'ADDRESS.UPDATED',
    entityType: 'Address',
    entityId: updated.id,
    tenantId: scope.tenantId ?? undefined,
    userId,
    metadata: { ownerType: scope.ownerType },
  });

  return updated;
}

export async function setDefaultAddress(
  id: string,
  scope: OwnerScope,
  userId: string,
): Promise<Address> {
  const existing = await addressRepo.findById(id, scope);
  if (!existing) {
    throw AppError.notFound('Address not found');
  }

  const updated = await executeWithScope(scope, async (tx) => {
    await addressRepo.clearDefaultForOwnerAndType(scope, existing.type, tx);
    return addressRepo.updateAddress(id, { isDefault: true }, tx);
  });

  if (!updated) {
    throw AppError.notFound('Address not found');
  }

  await logSecurityEvent({
    action: 'ADDRESS.UPDATED',
    entityType: 'Address',
    entityId: updated.id,
    tenantId: scope.tenantId ?? undefined,
    userId,
    metadata: { ownerType: scope.ownerType, isDefault: true },
  });

  return updated;
}

export async function deleteAddress(
  id: string,
  scope: OwnerScope,
  userId: string,
): Promise<void> {
  const existing = await addressRepo.findById(id, scope);
  if (!existing) {
    throw AppError.notFound('Address not found');
  }

  await executeWithScope(scope, async (tx) => {
    return addressRepo.softDeleteAddress(id, tx);
  });

  await logSecurityEvent({
    action: 'ADDRESS.DELETED',
    entityType: 'Address',
    entityId: id,
    tenantId: scope.tenantId ?? undefined,
    userId,
    metadata: { ownerType: scope.ownerType },
  });
}
