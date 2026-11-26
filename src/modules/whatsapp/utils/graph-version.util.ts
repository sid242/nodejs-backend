import { logger } from '@/config/logger';

export const META_GRAPH_VERSION_EXPIRIES: Record<string, string> = {
  'v19.0': '2026-05-14',
  'v20.0': '2026-09-17',
  'v21.0': '2027-01-21',
  'v22.0': '2027-05-20',
  'v23.0': '2027-10-14',
  'v24.0': '2028-02-17',
  'v25.0': '2028-07-29',
  'v26.0': '2028-11-18',
};

export interface GraphVersionCheckResult {
  version: string;
  expiryDate?: string;
  isExpired: boolean;
  daysRemaining: number | null;
  warning?: string;
}

/**
 * Checks whether a Meta Graph API version is expired or within 90 days of expiry.
 */
export function checkGraphApiVersionExpiry(
  version: string,
  referenceDate: Date = new Date(),
): GraphVersionCheckResult {
  const normalized = version.startsWith('v') ? version : `v${version}`;
  const expiryDate = META_GRAPH_VERSION_EXPIRIES[normalized];

  if (!expiryDate) {
    return {
      version: normalized,
      isExpired: false,
      daysRemaining: null,
    };
  }

  const expiry = new Date(expiryDate);
  const diffMs = expiry.getTime() - referenceDate.getTime();
  const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const isExpired = daysRemaining <= 0;

  let warning: string | undefined;
  if (isExpired) {
    warning = `Meta Graph API version ${normalized} expired on ${expiryDate}. Immediate upgrade required.`;
  } else if (daysRemaining <= 90) {
    warning = `Meta Graph API version ${normalized} will expire on ${expiryDate} (${daysRemaining} days remaining). Upgrade to a newer stable version.`;
  }

  return {
    version: normalized,
    expiryDate,
    isExpired,
    daysRemaining,
    warning,
  };
}

/**
 * Warns if the configured Meta Graph API version is close to or past expiry.
 */
export function warnIfGraphVersionCloseToExpiry(version: string): void {
  const result = checkGraphApiVersionExpiry(version);
  if (result.warning) {
    logger.warn(
      {
        version: result.version,
        expiryDate: result.expiryDate,
        daysRemaining: result.daysRemaining,
        isExpired: result.isExpired,
      },
      result.warning,
    );
  }
}
