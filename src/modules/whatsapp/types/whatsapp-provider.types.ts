export type WhatsAppTemplateCategory = 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';

export type WhatsAppTemplateStatus =
  'DRAFT' | 'SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'DELETED';

export type WhatsAppMessageType =
  'TEMPLATE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'AUDIO' | 'LOCATION' | 'INTERACTIVE';

export interface TemplateComponentParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  image?: { link?: string; id?: string };
  document?: { link?: string; id?: string; filename?: string };
  video?: { link?: string; id?: string };
  currency?: { fallback_value: string; code: string; amount_1000: number };
  date_time?: { fallback_value: string };
}

export interface TemplateComponentInput {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: TemplateComponentParameter[];
}

export interface SendTemplateMessageInput {
  phoneNumberId: string;
  accessToken: string;
  to: string; // E.164
  template: {
    name: string;
    language: { code: string };
    components?: TemplateComponentInput[];
  };
}

export interface SendTextMessageInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface SendMediaMessageInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  type: 'image' | 'document' | 'video' | 'audio';
  media: {
    id?: string;
    link?: string;
    caption?: string;
    filename?: string;
  };
}

export interface ProviderSendResult {
  providerMessageId: string;
  status: 'accepted' | 'sent';
  recipientId: string;
  rawResponse: Record<string, unknown>;
}

export interface TemplateComponentDefinition {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION';
  text?: string;
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTP';
    text: string;
    url?: string;
    phone_number?: string;
    otp_type?: 'COPY_CODE' | 'ONE_TAP';
  }>;
}

export interface CreateTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  category: WhatsAppTemplateCategory;
  language: string;
  components: TemplateComponentDefinition[];
}

export interface ProviderTemplateResult {
  id: string;
  name: string;
  status: WhatsAppTemplateStatus;
  category: WhatsAppTemplateCategory;
  language: string;
  components?: TemplateComponentDefinition[];
  rejectionReason?: string;
  qualityRating?: string;
}

export interface GetTemplatesInput {
  wabaId: string;
  accessToken: string;
  limit?: number;
  after?: string;
}

export interface DeleteTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  templateId?: string;
}

export interface ProviderPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  messagingLimit?: string;
  codeVerificationStatus?: string;
}

export interface UploadMediaInput {
  phoneNumberId: string;
  accessToken: string;
  fileBuffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface ProviderMediaResult {
  id: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}
