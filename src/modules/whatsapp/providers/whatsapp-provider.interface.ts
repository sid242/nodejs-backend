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
  TokenDebugResult,
  TokenExchangeResult,
  UploadMediaInput,
} from '../types/whatsapp-provider.types';

export interface IWhatsAppProvider {
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<ProviderSendResult>;
  sendTextMessage(input: SendTextMessageInput): Promise<ProviderSendResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<ProviderSendResult>;
  createTemplate(input: CreateTemplateInput): Promise<ProviderTemplateResult>;
  getTemplates(input: GetTemplatesInput): Promise<ProviderTemplateResult[]>;
  deleteTemplate(input: DeleteTemplateInput): Promise<void>;
  getPhoneNumbers(wabaId: string, accessToken: string): Promise<ProviderPhoneNumber[]>;
  uploadMedia(input: UploadMediaInput): Promise<ProviderMediaResult>;
  exchangeCodeForToken(code: string): Promise<TokenExchangeResult>;
  debugToken(inputToken: string): Promise<TokenDebugResult>;
  subscribeWabaWebhooks(wabaId: string, accessToken: string): Promise<boolean>;
}
