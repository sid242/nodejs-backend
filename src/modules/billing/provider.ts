import type { Request } from 'express';

import type { Subscription } from '@/db/schema/subscriptions';
import type { Tenant } from '@/db/schema/tenants/tenants';
import { AppError } from '@/lib/errors';

export interface CheckoutResult {
  checkoutUrl?: string;
  providerSubscriptionId?: string;
}

export interface WebhookResult {
  eventType: string;
  tenantId?: string;
  subscriptionId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface BillingProvider {
  name: string;
  createCheckout(tenant: Tenant, planKey: string): Promise<CheckoutResult>;
  cancel(subscription: Subscription): Promise<void>;
  parseWebhook(req: Request): Promise<WebhookResult>;
}

export class ManualBillingProvider implements BillingProvider {
  public readonly name = 'manual';

  public async createCheckout(_tenant: Tenant, _planKey: string): Promise<CheckoutResult> {
    throw AppError.badRequest('Automated checkout is not supported by manual billing provider. Please contact sales or platform staff.');
  }

  public async cancel(_subscription: Subscription): Promise<void> {
    // No-op for manual billing provider
  }

  public async parseWebhook(_req: Request): Promise<WebhookResult> {
    throw AppError.badRequest('Webhooks are not supported by manual billing provider');
  }
}

export const manualBillingProvider = new ManualBillingProvider();

export function getBillingProvider(providerName = 'manual'): BillingProvider {
  if (providerName.toLowerCase() === 'manual') {
    return manualBillingProvider;
  }
  throw AppError.badRequest(`Unsupported billing provider: ${providerName}`);
}
