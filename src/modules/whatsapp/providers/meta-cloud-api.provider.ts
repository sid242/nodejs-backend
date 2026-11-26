import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import type {
  CreateTemplateInput,
  DeleteTemplateInput,
  GetTemplatesInput,
  ProviderMediaResult,
  ProviderPhoneNumber,
  ProviderSendResult,
  ProviderTemplateResult,
  SendMediaMessageInput,
  SendTemplateMessageInput,
  SendTextMessageInput,
  TemplateComponentDefinition,
  TokenDebugResult,
  TokenExchangeResult,
  UploadMediaInput,
  WhatsAppTemplateCategory,
  WhatsAppTemplateStatus,
} from '../types/whatsapp-provider.types';
import type { IWhatsAppProvider } from './whatsapp-provider.interface';

export class MetaCloudApiProvider implements IWhatsAppProvider {
  private readonly baseUrl: string;
  private readonly graphVersion: string;

  constructor(graphVersion?: string) {
    this.graphVersion = graphVersion ?? env.META_GRAPH_API_VERSION ?? 'v21.0';
    this.baseUrl = `https://graph.facebook.com/${this.graphVersion}`;
  }

  private mapGraphError(errorData: unknown, status: number): AppError {
    const err = (errorData as Record<string, unknown>)?.error as
      Record<string, unknown> | undefined;
    const code = Number(err?.code ?? status);
    const subcode = Number(err?.error_subcode ?? 0);
    const message = String(err?.message ?? 'Unknown Meta Graph API error');

    logger.warn({ code, subcode, message }, 'Meta Graph API call failed');

    // 1. Authentication / Token failures
    if (code === 190 || subcode === 463 || subcode === 467) {
      return new AppError(
        401,
        `Meta access token expired or revoked: ${message}`,
        'WHATSAPP_PROVIDER_AUTH_FAILED',
        { code, subcode, raw: err },
      );
    }

    // 2. Rate limiting
    if (code === 80007 || code === 131056 || code === 4 || code === 17) {
      return new AppError(
        429,
        `Meta Cloud API rate limit exceeded: ${message}`,
        'WHATSAPP_RATE_LIMITED',
        { code, subcode, raw: err },
      );
    }

    // 3. Customer Service Window (24h) Expired
    if (code === 131047 || subcode === 2494010) {
      return new AppError(
        400,
        'Cannot send free-form message: 24-hour customer service window expired. Use an approved template.',
        'WHATSAPP_CUSTOMER_SERVICE_WINDOW_EXPIRED',
        { code, subcode, raw: err },
      );
    }

    // 4. Recipient Invalid / Not on WhatsApp
    if (code === 131026) {
      return new AppError(
        400,
        `Recipient is not a valid WhatsApp user: ${message}`,
        'WHATSAPP_RECIPIENT_INVALID',
        { code, subcode, raw: err },
      );
    }

    // 5. Template Not Found or Not Approved
    if (code === 132000 || code === 132001) {
      return new AppError(
        404,
        `WhatsApp template not found: ${message}`,
        'WHATSAPP_TEMPLATE_NOT_FOUND',
        { code, subcode, raw: err },
      );
    }
    if (code === 132007) {
      return new AppError(
        400,
        `WhatsApp template is not approved or is paused: ${message}`,
        'WHATSAPP_TEMPLATE_NOT_APPROVED',
        { code, subcode, raw: err },
      );
    }

    // 6. Network or Provider Unavailable
    if (status >= 500) {
      return new AppError(
        503,
        `Meta Cloud API service unavailable: ${message}`,
        'WHATSAPP_PROVIDER_UNAVAILABLE',
        { code, subcode, raw: err },
      );
    }

    return new AppError(400, `Meta Cloud API error: ${message}`, 'WHATSAPP_MESSAGE_FAILED', {
      code,
      subcode,
      raw: err,
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      accessToken: string;
      body?: unknown;
      headers?: Record<string, string>;
      isFormData?: boolean;
    },
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.accessToken}`,
      ...options.headers,
    };

    let reqBody: BodyInit | undefined;
    if (options.body) {
      if (options.isFormData) {
        reqBody = options.body as FormData;
      } else {
        headers['Content-Type'] = 'application/json';
        reqBody = JSON.stringify(options.body);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: reqBody,
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        throw this.mapGraphError(json, response.status);
      }

      return json as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError(504, 'Meta Graph API request timed out', 'WHATSAPP_PROVIDER_TIMEOUT');
      }
      throw new AppError(
        503,
        `Failed to communicate with Meta Cloud API: ${err instanceof Error ? err.message : String(err)}`,
        'WHATSAPP_PROVIDER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<ProviderSendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: input.template.name,
        language: input.template.language,
        components: input.template.components,
      },
    };

    const res = await this.request<{
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    }>(`/${input.phoneNumberId}/messages`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: payload,
    });

    const wamid = res.messages?.[0]?.id;
    if (!wamid) {
      throw new AppError(
        502,
        'Meta did not return a valid provider message ID',
        'WHATSAPP_MESSAGE_FAILED',
      );
    }

    return {
      providerMessageId: wamid,
      status: 'accepted',
      recipientId: res.contacts?.[0]?.wa_id ?? input.to,
      rawResponse: res,
    };
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<ProviderSendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to.replace(/^\+/, ''),
      type: 'text',
      text: {
        body: input.text,
        preview_url: input.previewUrl ?? false,
      },
    };

    const res = await this.request<{
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    }>(`/${input.phoneNumberId}/messages`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: payload,
    });

    const wamid = res.messages?.[0]?.id;
    if (!wamid) {
      throw new AppError(
        502,
        'Meta did not return a valid provider message ID',
        'WHATSAPP_MESSAGE_FAILED',
      );
    }

    return {
      providerMessageId: wamid,
      status: 'accepted',
      recipientId: res.contacts?.[0]?.wa_id ?? input.to,
      rawResponse: res,
    };
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<ProviderSendResult> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to.replace(/^\+/, ''),
      type: input.type,
      [input.type]: input.media,
    };

    const res = await this.request<{
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    }>(`/${input.phoneNumberId}/messages`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: payload,
    });

    const wamid = res.messages?.[0]?.id;
    if (!wamid) {
      throw new AppError(
        502,
        'Meta did not return a valid provider message ID',
        'WHATSAPP_MESSAGE_FAILED',
      );
    }

    return {
      providerMessageId: wamid,
      status: 'accepted',
      recipientId: res.contacts?.[0]?.wa_id ?? input.to,
      rawResponse: res,
    };
  }

  async createTemplate(input: CreateTemplateInput): Promise<ProviderTemplateResult> {
    const payload = {
      name: input.name,
      category: input.category,
      language: input.language,
      components: input.components,
    };

    const res = await this.request<{ id: string; status: string; category: string }>(
      `/${input.wabaId}/message_templates`,
      {
        method: 'POST',
        accessToken: input.accessToken,
        body: payload,
      },
    );

    return {
      id: res.id,
      name: input.name,
      status: (res.status?.toUpperCase() ?? 'PENDING') as WhatsAppTemplateStatus,
      category: (res.category?.toUpperCase() ?? input.category) as WhatsAppTemplateCategory,
      language: input.language,
      components: input.components,
    };
  }

  async getTemplates(input: GetTemplatesInput): Promise<ProviderTemplateResult[]> {
    const limit = input.limit ?? 100;
    const endpoint = `/${input.wabaId}/message_templates?limit=${limit}${input.after ? `&after=${input.after}` : ''}`;

    const res = await this.request<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        category: string;
        language: string;
        components?: unknown[];
        rejected_reason?: string;
        quality_score?: { score: string };
      }>;
    }>(endpoint, {
      method: 'GET',
      accessToken: input.accessToken,
    });

    return (res.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      status: (t.status?.toUpperCase() ?? 'PENDING') as WhatsAppTemplateStatus,
      category: (t.category?.toUpperCase() ?? 'UTILITY') as WhatsAppTemplateCategory,
      language: t.language,
      components: t.components as unknown as TemplateComponentDefinition[],
      rejectionReason: t.rejected_reason,
      qualityRating: t.quality_score?.score,
    }));
  }

  async deleteTemplate(input: DeleteTemplateInput): Promise<void> {
    const endpoint = `/${input.wabaId}/message_templates?name=${encodeURIComponent(input.name)}`;
    await this.request(endpoint, {
      method: 'DELETE',
      accessToken: input.accessToken,
    });
  }

  async getPhoneNumbers(wabaId: string, accessToken: string): Promise<ProviderPhoneNumber[]> {
    const res = await this.request<{
      data: Array<{
        id: string;
        display_phone_number: string;
        verified_name: string;
        quality_rating: string;
        messaging_limit_tier?: string;
        code_verification_status?: string;
      }>;
    }>(`/${wabaId}/phone_numbers`, {
      method: 'GET',
      accessToken,
    });

    return (res.data ?? []).map((p) => ({
      id: p.id,
      displayPhoneNumber: p.display_phone_number,
      verifiedName: p.verified_name,
      qualityRating: p.quality_rating,
      messagingLimit: p.messaging_limit_tier,
      codeVerificationStatus: p.code_verification_status,
    }));
  }

  async uploadMedia(input: UploadMediaInput): Promise<ProviderMediaResult> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType });
    formData.append('file', blob, input.filename);
    formData.append('type', input.mimeType);
    formData.append('messaging_product', 'whatsapp');

    const res = await this.request<{ id: string }>(`/${input.phoneNumberId}/media`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: formData,
      isFormData: true,
    });

    return { id: res.id };
  }

  async exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
    const appId = env.META_APP_ID;
    const appSecret = env.META_APP_SECRET;

    if (!appId || !appSecret) {
      throw AppError.internal(
        'Meta App credentials (META_APP_ID, META_APP_SECRET) are not configured',
      );
    }

    const res = await this.request<{
      access_token: string;
      token_type: string;
      expires_in?: number;
    }>('/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
      }),
      accessToken: `${appId}|${appSecret}`,
    });

    return {
      accessToken: res.access_token,
      tokenType: res.token_type,
      expiresIn: res.expires_in,
    };
  }

  async debugToken(inputToken: string): Promise<TokenDebugResult> {
    const appId = env.META_APP_ID;
    const appSecret = env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return { appId: 'mock_app', isValid: true, scopes: [] };
    }

    const res = await this.request<{
      data: {
        app_id: string;
        is_valid: boolean;
        scopes?: string[];
      };
    }>(`/debug_token?input_token=${encodeURIComponent(inputToken)}`, {
      method: 'GET',
      accessToken: `${appId}|${appSecret}`,
    });

    return {
      appId: res.data.app_id,
      isValid: res.data.is_valid,
      scopes: res.data.scopes || [],
    };
  }

  async subscribeWabaWebhooks(wabaId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await this.request<{ success: boolean }>(`/${wabaId}/subscribed_apps`, {
        method: 'POST',
        accessToken,
      });
      return res.success === true;
    } catch (err) {
      logger.warn({ err, wabaId }, 'Failed to subscribe WABA to webhook events');
      return false;
    }
  }

  async unsubscribeWabaWebhooks(wabaId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await this.request<{ success: boolean }>(`/${wabaId}/subscribed_apps`, {
        method: 'DELETE',
        accessToken,
      });
      return res.success === true;
    } catch (err) {
      logger.warn({ err, wabaId }, 'Failed to unsubscribe WABA from webhook events');
      return false;
    }
  }
}

export const metaWhatsAppProvider = new MetaCloudApiProvider();
