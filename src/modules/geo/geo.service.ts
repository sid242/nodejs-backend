import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { GEO_LEVEL } from '@/db/geo';
import * as geoRepo from './geo.repository';

const GEO_TTL_SECONDS = 86400; // 24 hours

export async function getStates() {
  return cache.wrap('geo:states', GEO_TTL_SECONDS, async () => {
    return geoRepo.listStates();
  });
}

export async function getChildren(parentId: number, levelId: number, q?: string) {
  const cacheKey = `geo:children:${parentId}:${levelId}:${q?.toLowerCase() ?? ''}`;
  return cache.wrap(cacheKey, GEO_TTL_SECONDS, async () => {
    return geoRepo.listChildren(parentId, levelId, q);
  });
}

export async function getPinDetails(pin: string) {
  const cacheKey = `geo:pin:${pin}`;
  return cache.wrap(cacheKey, GEO_TTL_SECONDS, async () => {
    const area = await geoRepo.findByPinCode(pin);
    if (!area) {
      throw AppError.notFound(`PIN code ${pin} not found`);
    }

    const chain = await geoRepo.ancestorChainOf(area.id);
    const state = chain?.find((item) => item?.levelId === GEO_LEVEL.STATE) ?? null;
    const district = chain?.find((item) => item?.levelId === GEO_LEVEL.DISTRICT) ?? null;
    const subdistrict = chain?.find((item) => item?.levelId === GEO_LEVEL.SUBDISTRICT) ?? null;

    return {
      pin,
      area: {
        id: area.id,
        name: area.name,
        code: area.sourceCode,
      },
      state: state ? { id: state.id, name: state.name, code: state.code } : null,
      district: district ? { id: district.id, name: district.name, code: district.code } : null,
      subdistrict: subdistrict ? { id: subdistrict.id, name: subdistrict.name, code: subdistrict.code } : null,
      chain: chain ?? [],
    };
  });
}

export async function lookupCoordinates(lat: number, lng: number) {
  // Round to ~11 meters for cache locality
  const cacheKey = `geo:lookup:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  return cache.wrap(cacheKey, GEO_TTL_SECONDS, async () => {
    return geoRepo.lookupPoint(lat, lng);
  });
}

