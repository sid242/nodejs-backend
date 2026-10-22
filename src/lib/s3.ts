import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type DeleteObjectCommandOutput,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/config/env.js';
import { safeFilename } from '@/lib/utils.js';

// Credentials come from the default provider chain: IAM task role on AWS, env keys locally.
export const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE }),
});

const Bucket = env.S3_BUCKET;

export interface CreateUploadPostOptions {
  key: string;
  contentType: string;
  expiresIn?: number;
}

/**
 * Browser uploads directly to S3 (files never pass through our servers).
 * Presigned POST lets us enforce a max size and exact content type.
 */
export function createUploadPost({
  key,
  contentType,
  expiresIn = 300,
}: CreateUploadPostOptions): Promise<PresignedPost> {
  return createPresignedPost(s3, {
    Bucket,
    Key: key,
    Expires: expiresIn,
    Fields: { 'Content-Type': contentType },
    Conditions: [
      ['content-length-range', 1, env.S3_MAX_UPLOAD_MB * 1024 * 1024],
      ['eq', '$Content-Type', contentType],
    ],
  });
}

export interface CreateDownloadUrlOptions {
  filename?: string;
  disposition?: 'inline' | 'attachment';
}

export const createDownloadUrl = (
  key: string,
  expiresIn = 300,
  options?: CreateDownloadUrlOptions,
): Promise<string> => {
  let contentDisposition: string | undefined;
  if (options?.disposition) {
    const filename = options.filename ? safeFilename(options.filename) : 'download';
    contentDisposition = `${options.disposition}; filename="${filename}"`;
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket,
      Key: key,
      ...(contentDisposition && { ResponseContentDisposition: contentDisposition }),
    }),
    { expiresIn },
  );
};

export const headObject = (key: string): Promise<HeadObjectCommandOutput> =>
  s3.send(new HeadObjectCommand({ Bucket, Key: key }));

export const deleteObject = (key: string): Promise<DeleteObjectCommandOutput> =>
  s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
