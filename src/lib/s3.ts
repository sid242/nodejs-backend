import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/config/env';
import { getClientHost } from '@/lib/request-context';
import { safeFilename } from '@/lib/utils';

// Credentials come from the default provider chain: IAM task role on AWS, env keys locally.
export const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE }),
});

const clientCache = new Map<string, S3Client>();

/**
 * Returns an S3 client configured with the appropriate endpoint for the caller.
 * In local development, if a client accesses the app via LAN (e.g. 192.168.1.33),
 * signing S3 requests with localhost causes AWS Signature Version 4 Host mismatches.
 */
export function getS3ClientForHost(explicitHost?: string): S3Client {
  const clientHost = explicitHost || getClientHost();
  if (!env.S3_ENDPOINT || !clientHost) return s3;

  try {
    const endpointUrl = new URL(env.S3_ENDPOINT);
    const isLocalStorage =
      endpointUrl.hostname === 'localhost' || endpointUrl.hostname === '127.0.0.1';
    if (!isLocalStorage) return s3;

    // clientHost could be "192.168.1.33:3001", "192.168.1.33", "acme-realty.localhost:3001"
    const hostWithoutPort = clientHost.split(':')[0]?.trim()?.toLowerCase();
    if (
      !hostWithoutPort ||
      hostWithoutPort === 'localhost' ||
      hostWithoutPort === '127.0.0.1' ||
      hostWithoutPort.endsWith('.localhost')
    ) {
      return s3;
    }

    const targetPort = endpointUrl.port || '9000';
    const targetEndpoint = `${endpointUrl.protocol}//${hostWithoutPort}:${targetPort}`;

    let cached = clientCache.get(targetEndpoint);
    if (!cached) {
      cached = new S3Client({
        region: env.AWS_REGION,
        endpoint: targetEndpoint,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
      clientCache.set(targetEndpoint, cached);
    }
    return cached;
  } catch {
    return s3;
  }
}

const Bucket = env.S3_BUCKET;

export interface CreateUploadPostOptions {
  key: string;
  contentType: string;
  expiresIn?: number;
  clientHost?: string;
}

/**
 * Browser uploads directly to S3 (files never pass through our servers).
 * Presigned POST lets us enforce a max size and exact content type.
 */
export function createUploadPost({
  key,
  contentType,
  expiresIn = 300,
  clientHost,
}: CreateUploadPostOptions): Promise<PresignedPost> {
  const client = getS3ClientForHost(clientHost);
  return createPresignedPost(client, {
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
  contentType?: string;
  disposition?: 'inline' | 'attachment';
  clientHost?: string;
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

  const client = getS3ClientForHost(options?.clientHost);

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket,
      Key: key,
      ...(contentDisposition && { ResponseContentDisposition: contentDisposition }),
      ...(options?.contentType && { ResponseContentType: options.contentType }),
    }),
    { expiresIn },
  );
};

/** Read a bounded upload for scanning. The server writes the verified bytes under a separate key. */
export async function readUploadBytes(key: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(30_000);
  const object = await s3.send(new GetObjectCommand({ Bucket, Key: key }), { abortSignal: signal });
  const maxBytes = env.S3_MAX_UPLOAD_MB * 1024 * 1024;
  if (!object.Body || !object.ContentLength || object.ContentLength > maxBytes) {
    if (object.Body && 'destroy' in object.Body) object.Body.destroy();
    throw new Error('File scan requires a nonempty object within the upload size limit');
  }
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength !== object.ContentLength) throw new Error('Unexpected upload size');
  return bytes;
}

export const headObject = (key: string): Promise<HeadObjectCommandOutput> =>
  s3.send(new HeadObjectCommand({ Bucket, Key: key }));

export const deleteObject = (key: string): Promise<DeleteObjectCommandOutput> =>
  s3.send(new DeleteObjectCommand({ Bucket, Key: key }));

export const putObject = (
  key: string,
  body: Buffer | Uint8Array | string,
  contentType = 'application/json',
  metadata?: Record<string, string>,
): Promise<PutObjectCommandOutput> =>
  s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }),
  );

let policyEnsured = false;

/**
 * Ensures public read access to avatars, tenants, and branding assets in MinIO / S3.
 * Gracefully ignores errors in managed production environments where policies are IAM-locked.
 */
export async function ensurePublicBucketPolicies(): Promise<void> {
  if (policyEnsured) return;
  try {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadAvatarsAndTenants',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [
            `arn:aws:s3:::${env.S3_BUCKET}/tenants/*/branding/*`,
            `arn:aws:s3:::${env.S3_BUCKET}/avatars/*`,
            `arn:aws:s3:::${env.S3_BUCKET}/branding/*`,
          ],
        },
      ],
    };
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: env.S3_BUCKET,
        Policy: JSON.stringify(policy),
      }),
    );
    policyEnsured = true;
  } catch {
    // Graceful no-op if IAM policy prevents PutBucketPolicy or in managed cloud environments
  }
}
