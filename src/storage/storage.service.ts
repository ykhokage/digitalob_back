import { BadRequestException, Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';

type UploadOptions = {
  requireRemote?: boolean;
};

@Injectable()
export class StorageService {
  private s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'ru-central1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials:
      process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || '',
          }
        : undefined,
  });

  isRemoteConfigured() {
    return Boolean(this.validEnv(process.env.S3_ENDPOINT) && this.validEnv(process.env.S3_BUCKET) && this.validEnv(this.accessKey()) && this.validEnv(this.secretKey()));
  }

  async upload(key: string, body: Buffer, contentType: string, options: UploadOptions = {}) {
    if (this.isRemoteConfigured()) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return this.publicUrl(key);
    }

    if (options.requireRemote || process.env.STORAGE_REQUIRE_S3 === 'true') {
      throw new BadRequestException('Yandex Object Storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
    }

    const filePath = join(process.cwd(), 'uploads', key);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(filePath, body);
    return `http://localhost:${process.env.PORT || 4000}/uploads/${key.replaceAll('\\', '/')}`;
  }

  private publicUrl(key: string) {
    if (process.env.S3_PUBLIC_BASE_URL) {
      return `${process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    }

    const endpoint = (process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net').replace(/\/$/, '');
    const bucket = process.env.S3_BUCKET;
    if (endpoint.includes('storage.yandexcloud.net') && bucket) {
      return `https://${bucket}.storage.yandexcloud.net/${key}`;
    }

    return `${endpoint}/${bucket}/${key}`;
  }

  private accessKey() {
    return process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY;
  }

  private secretKey() {
    return process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY;
  }

  private validEnv(value?: string) {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return !['xxx', '...', 'change_me', 'replace_me', 'your_value'].includes(normalized);
  }
}
