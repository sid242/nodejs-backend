export interface GstBreakdownItem {
  name: string;
  ratePercent: number;
  amountMinor: number;
}

export interface GstBreakdownResult {
  subtotalMinor: number;
  taxMinor: number;
  taxBreakdown: GstBreakdownItem[];
}

/**
 * Calculates Indian GST breakdown for invoice line items.
 * Assumes total payment amount is tax-inclusive.
 *
 * @param amountMinor Total amount in paise / minor units
 * @param currency Currency code (defaults to 'INR')
 * @param isInterState Whether customer is outside merchant's registered state (IGST vs CGST+SGST)
 * @param taxRatePercent Total GST rate percentage (defaults to 18%)
 */
export function calculateGstBreakdown(
  amountMinor: number,
  currency = 'INR',
  isInterState = false,
  taxRatePercent = 18,
): GstBreakdownResult {
  if (currency.toUpperCase() !== 'INR' || taxRatePercent <= 0 || amountMinor <= 0) {
    return {
      subtotalMinor: amountMinor,
      taxMinor: 0,
      taxBreakdown: [],
    };
  }

  // Calculate tax-inclusive subtotal: subtotal = (amountMinor * 100) / (100 + rate)
  const subtotalMinor = Math.round((amountMinor * 100) / (100 + taxRatePercent));
  const taxMinor = amountMinor - subtotalMinor;

  if (isInterState) {
    return {
      subtotalMinor,
      taxMinor,
      taxBreakdown: [
        {
          name: 'IGST',
          ratePercent: taxRatePercent,
          amountMinor: taxMinor,
        },
      ],
    };
  }

  const halfRate = taxRatePercent / 2;
  const cgst = Math.floor(taxMinor / 2);
  const sgst = taxMinor - cgst;

  return {
    subtotalMinor,
    taxMinor,
    taxBreakdown: [
      {
        name: 'CGST',
        ratePercent: halfRate,
        amountMinor: cgst,
      },
      {
        name: 'SGST',
        ratePercent: halfRate,
        amountMinor: sgst,
      },
    ],
  };
}
