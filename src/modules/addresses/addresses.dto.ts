import { z } from 'zod';

export const ADDRESS_TYPES = [
  'HOME',
  'WORK',
  'BILLING',
  'SHIPPING',
  'REGISTERED',
  'BRANCH',
  'OTHER',
] as const;

export type AddressType = (typeof ADDRESS_TYPES)[number];

const geoId = z.number().int().positive();

export const addressBodyDto = z
  .object({
    type: z.enum(ADDRESS_TYPES).default('OTHER'),
    label: z.string().trim().max(60).optional(),
    recipientName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(20).optional(),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(120).optional(),
    countryCode: z.string().length(2).toUpperCase().default('IN'),
    postalCode: z.string().trim().max(12).optional(),
    stateGeoId: geoId.optional(),
    districtGeoId: geoId.optional(),
    subdistrictGeoId: geoId.optional(),
    localityKind: z.enum(['CITY', 'VILLAGE']).optional(),
    localityGeoId: geoId.optional(),
    areaGeoId: geoId.optional(),
    // free text for non-India addresses
    stateName: z.string().trim().max(120).optional(),
    districtName: z.string().trim().max(120).optional(),
    subdistrictName: z.string().trim().max(120).optional(),
    localityName: z.string().trim().max(120).optional(),
    areaName: z.string().trim().max(120).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.countryCode === 'IN') {
      if (!v.postalCode || !/^[1-9]\d{5}$/.test(v.postalCode)) {
        ctx.addIssue({
          code: 'custom',
          path: ['postalCode'],
          message: 'Enter a valid 6-digit PIN code',
        });
      }
      if (!v.stateGeoId) {
        ctx.addIssue({
          code: 'custom',
          path: ['stateGeoId'],
          message: 'State is required',
        });
      }
    } else {
      if (
        v.stateGeoId !== undefined ||
        v.districtGeoId !== undefined ||
        v.subdistrictGeoId !== undefined ||
        v.localityGeoId !== undefined ||
        v.areaGeoId !== undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['countryCode'],
          message: 'Location ids are only valid for India',
        });
      }
    }
  });

export type AddressBody = z.infer<typeof addressBodyDto>;

export const addressPatchDto = z
  .object({
    type: z.enum(ADDRESS_TYPES).optional(),
    label: z.string().trim().max(60).optional(),
    recipientName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(20).optional(),
    line1: z.string().trim().min(3).max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(120).optional(),
    countryCode: z.string().length(2).toUpperCase().optional(),
    postalCode: z.string().trim().max(12).optional(),
    stateGeoId: geoId.optional(),
    districtGeoId: geoId.optional(),
    subdistrictGeoId: geoId.optional(),
    localityKind: z.enum(['CITY', 'VILLAGE']).optional(),
    localityGeoId: geoId.optional(),
    areaGeoId: geoId.optional(),
    stateName: z.string().trim().max(120).optional(),
    districtName: z.string().trim().max(120).optional(),
    subdistrictName: z.string().trim().max(120).optional(),
    localityName: z.string().trim().max(120).optional(),
    areaName: z.string().trim().max(120).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.countryCode === 'IN' && v.postalCode && !/^[1-9]\d{5}$/.test(v.postalCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['postalCode'],
        message: 'Enter a valid 6-digit PIN code',
      });
    }
    if (
      v.countryCode &&
      v.countryCode !== 'IN' &&
      (v.stateGeoId !== undefined ||
        v.districtGeoId !== undefined ||
        v.subdistrictGeoId !== undefined ||
        v.localityGeoId !== undefined ||
        v.areaGeoId !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['countryCode'],
        message: 'Location ids are only valid for India',
      });
    }
  });

export type AddressPatch = z.infer<typeof addressPatchDto>;

export const addressIdParamDto = z.object({
  id: z.string().uuid(),
});

export const memberIdParamDto = z.object({
  memberId: z.string().uuid(),
});

export const memberAddressParamDto = z.object({
  memberId: z.string().uuid(),
  id: z.string().uuid(),
});

