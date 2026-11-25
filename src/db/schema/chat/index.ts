export interface ChatAttachmentMetadata {
  id: string;
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export * from './tenant-chat';
export * from './platform-chat';
