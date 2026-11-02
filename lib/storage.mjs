// Rechnungsarchiv im S3-Bucket: invoices/<jahr>/<bestellnummer>.json
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export function createStorage(s3) {
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  const bucket = s3.bucket;

  return {
    bucket,
    client,
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (err) {
        if (err?.$metadata?.httpStatusCode !== 404 && err?.name !== 'NotFound') throw err;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },
    async putJson(key, value, metadata = {}) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(value, null, 2),
          ContentType: 'application/json',
          Metadata: metadata,
        }),
      );
    },
    async getJson(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return JSON.parse(await res.Body.transformToString('utf8'));
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    destroy() {
      client.destroy();
    },
  };
}
