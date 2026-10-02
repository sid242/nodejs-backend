import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

// Credentials come from the default provider chain: IAM task role on AWS, env keys locally.
export const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE }),
});

const Bucket = env.S3_BUCKET;

/**
 * Browser uploads directly to S3 (files never pass through our servers).
 * Presigned POST lets us enforce a max size and exact content type.
 */
export function createUploadPost({ key, contentType, expiresIn = 300 }) {
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

export const createDownloadUrl = (key, expiresIn = 300) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });

export const headObject = (key) => s3.send(new HeadObjectCommand({ Bucket, Key: key }));

export const deleteObject = (key) => s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
