import type { WhatsAppTemplateCategory } from '@/db/schema/enums';

export interface RateCardEntry {
  currency: string;
  rates: Record<WhatsAppTemplateCategory | 'SERVICE', number>;
}

export const CURRENT_RATE_CARD_VERSION = '2026-01';

/**
 * Official Meta WhatsApp Business Platform conversation rate cards (versioned).
 * Rates vary by recipient country market and conversation/template category.
 */
export const META_RATE_CARDS: Record<string, Record<string, RateCardEntry>> = {
  '2026-01': {
    IN: {
      currency: 'INR',
      rates: {
        MARKETING: 0.86,
        UTILITY: 0.115,
        AUTHENTICATION: 0.115,
        SERVICE: 0.0,
      },
    },
    US: {
      currency: 'USD',
      rates: {
        MARKETING: 0.025,
        UTILITY: 0.015,
        AUTHENTICATION: 0.0135,
        SERVICE: 0.0,
      },
    },
    GB: {
      currency: 'GBP',
      rates: {
        MARKETING: 0.045,
        UTILITY: 0.022,
        AUTHENTICATION: 0.02,
        SERVICE: 0.0,
      },
    },
    DEFAULT: {
      currency: 'INR',
      rates: {
        MARKETING: 0.86,
        UTILITY: 0.115,
        AUTHENTICATION: 0.115,
        SERVICE: 0.0,
      },
    },
  },
};

export interface CostEstimationResult {
  estimatedCost: string;
  currency: string;
  rateCardVersion: string;
}

/**
 * Calculates estimated message cost based on country, template category, and active rate card version.
 */
export function calculateEstimatedCost(
  category: WhatsAppTemplateCategory | 'SERVICE' | string,
  countryCode: string = 'IN',
  version: string = CURRENT_RATE_CARD_VERSION,
): CostEstimationResult {
  const versionCards = META_RATE_CARDS[version] || META_RATE_CARDS[CURRENT_RATE_CARD_VERSION]!;
  const normalizedCountry = (countryCode || 'IN').toUpperCase();
  const card = versionCards[normalizedCountry] || versionCards.DEFAULT!;

  const catKey = (category || 'UTILITY').toUpperCase() as WhatsAppTemplateCategory | 'SERVICE';
  const unitRate = card.rates[catKey] ?? card.rates.UTILITY ?? 0.115;

  return {
    estimatedCost: unitRate.toFixed(4),
    currency: card.currency,
    rateCardVersion: version,
  };
}
