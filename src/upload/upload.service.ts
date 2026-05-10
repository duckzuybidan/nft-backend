import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import FormData from 'form-data';
import { DatabaseService } from '../database/database.service';
import { decryptKey, decryptFile, downloadEncryptedFile } from './crypto.util';
@Injectable()
export class UploadService {
  constructor(private database: DatabaseService) {}

  async uploadFile(file: Express.Multer.File, userId: string) {
    const originalPath = file.path;
    const encryptedPath = `${originalPath}.enc`;

    try {
      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);

      await pipeline(
        fs.createReadStream(originalPath),
        cipher,
        fs.createWriteStream(encryptedPath),
      );

      const cid = await this.uploadToPinata(encryptedPath);

      const { encryptedKey, keyIv } = this.encryptKey(aesKey);

      const record = await this.database.file.create({
        data: {
          cid,
          encryptedKey,
          iv: iv.toString('hex'),
          keyIv,
          userId,

          metadata: {
            create: {
              fileName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
            },
          },
        },
        include: {
          metadata: true,
        },
      });

      fs.unlinkSync(originalPath);
      fs.unlinkSync(encryptedPath);

      return record;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  encryptKey(key: Buffer) {
    const masterKey = Buffer.from(process.env.MASTER_KEY!, 'hex');

    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', masterKey, iv);

    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);

    return {
      encryptedKey: encrypted.toString('hex'),
      keyIv: iv.toString('hex'),
    };
  }

  async uploadToPinata(path: string) {
    const data = new FormData();

    data.append('file', fs.createReadStream(path));

    const res = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      data,
      {
        headers: {
          ...data.getHeaders(),
          pinata_api_key: process.env.PINATA_API_KEY!,
          pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY!,
        },
      },
    );

    return res.data.IpfsHash;
  }

  async getFile(id: string) {
    const file = await this.database.file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const aesKey = decryptKey(file.encryptedKey, file.keyIv);

    const encryptedBuffer = await downloadEncryptedFile(file.cid);

    const decryptedBuffer = decryptFile(encryptedBuffer, aesKey, file.iv);

    return {
      buffer: decryptedBuffer,
      filename: `file-${id}`,
      mimeType: 'application/octet-stream',
    };
  }
}
