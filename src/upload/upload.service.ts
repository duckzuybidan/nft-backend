import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { configureFfmpeg } from '../common/ffmpeg.config';
import * as pdf from 'pdf-to-img';
import { DatabaseService } from '../database/database.service';
import { decryptKey, decryptFile, downloadEncryptedFile } from './crypto.util';
import { StreamingService } from '../stream/streaming.service';

@Injectable()
export class UploadService {
  constructor(
    private database: DatabaseService,
    private configService: ConfigService,
    @Inject(forwardRef(() => StreamingService))
    private streamingService: StreamingService,
  ) {}

  getGatewayUrl(cid: string) {
    const gateway =
      this.configService.get<string>('IPFS_GATEWAY') ||
      'https://gateway.pinata.cloud/ipfs/';
    return `${gateway}${cid}`;
  }

  async uploadFile(file: Express.Multer.File, userId: string) {
    const originalPath = file.path;
    const encryptedPath = `${originalPath}.enc`;
    let previewUrl: string | undefined;

    try {
      previewUrl = await this.generatePreview(file);

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
              previewImage: previewUrl,
            },
          },
        },
        include: {
          metadata: true,
        },
      });

      if (this.streamingService.isStreamableMimeType(file.mimetype)) {
        const streamSourcePath = `${originalPath}.stream-source`;
        fs.copyFileSync(originalPath, streamSourcePath);
        void this.streamingService
          .processMediaForStreaming(record.id, streamSourcePath, file.mimetype)
          .finally(() => {
            if (fs.existsSync(streamSourcePath)) {
              fs.unlinkSync(streamSourcePath);
            }
          });
      }

      fs.unlinkSync(originalPath);
      fs.unlinkSync(encryptedPath);

      return {
        ...record,
        fileUrl: this.getGatewayUrl(record.cid),
      };
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  private async generatePreview(
    file: Express.Multer.File,
  ): Promise<string | undefined> {
    const originalPath = file.path;
    const previewPath = path.join(
      path.dirname(originalPath),
      `preview-${path.basename(originalPath)}.png`,
    );

    try {
      if (file.mimetype.startsWith('image/')) {
        await sharp(originalPath)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .toFile(previewPath);
      } else if (file.mimetype.startsWith('video/')) {
        configureFfmpeg();
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .screenshots({
              timestamps: ['00:00:01'],
              filename: path.basename(previewPath),
              folder: path.dirname(previewPath),
              size: '400x400',
            })
            .on('end', resolve)
            .on('error', (err) => {
              console.error('FFmpeg error:', err);
              reject(err);
            });
        });
      } else if (file.mimetype === 'application/pdf') {
        const document = await pdf.pdf(originalPath, { scale: 2 });
        let firstPage: Buffer | undefined;
        for await (const page of document) {
          firstPage = page;
          break;
        }
        if (firstPage) {
          await sharp(firstPage)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .toFile(previewPath);
        } else {
          throw new Error('Could not extract first page from PDF');
        }
      } else if (
        file.mimetype.startsWith('text/') ||
        file.mimetype === 'application/json' ||
        file.mimetype === 'application/javascript' ||
        file.mimetype === 'application/x-javascript'
      ) {
        const content = fs.readFileSync(originalPath, 'utf8').slice(0, 1000);
        const lines = content.split('\n').slice(0, 20);
        const svgLines = lines
          .map(
            (line, i) =>
              `<tspan x="10" dy="${i === 0 ? '1.2em' : '1.2em'}">${this.escapeXml(
                line.slice(0, 60),
              )}</tspan>`,
          )
          .join('');

        const svg = `
          <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f8f9fa" />
            <text x="0" y="0" font-family="monospace" font-size="12" fill="#212529">
              ${svgLines}
            </text>
          </svg>
        `;

        await sharp(Buffer.from(svg)).toFile(previewPath);
      } else {
        return undefined;
      }

      if (fs.existsSync(previewPath)) {
        const previewCid = await this.uploadToPinata(previewPath);
        const previewUrl = this.getGatewayUrl(previewCid);
        fs.unlinkSync(previewPath);
        return previewUrl;
      }
    } catch (err) {
      console.error('Preview generation failed:', err);
      if (fs.existsSync(previewPath)) {
        try {
          fs.unlinkSync(previewPath);
        } catch (unlinkErr) {
          // ignore
        }
      }
    }
    return undefined;
  }

  private escapeXml(unsafe: string) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        case '"':
          return '&quot;';
        default:
          return c;
      }
    });
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

  async uploadJsonToPinata(payload: Record<string, unknown>, name?: string) {
    const res = await axios.post(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      {
        pinataContent: payload,
        pinataMetadata: {
          name: name || 'nft-metadata',
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: process.env.PINATA_API_KEY!,
          pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY!,
        },
      },
    );

    return res.data.IpfsHash as string;
  }

  async getFile(id: string) {
    const file = await this.database.file.findUnique({
      where: { id },
      include: { metadata: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const aesKey = decryptKey(file.encryptedKey, file.keyIv);

    const encryptedBuffer = await downloadEncryptedFile(file.cid);

    const decryptedBuffer = decryptFile(encryptedBuffer, aesKey, file.iv);

    return {
      buffer: decryptedBuffer,
      filename: file.metadata?.fileName || `file-${id}`,
      mimeType: file.metadata?.mimeType || 'application/octet-stream',
    };
  }
}
