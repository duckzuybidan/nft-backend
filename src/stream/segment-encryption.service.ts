import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  decryptKey,
  decryptSegment,
  encryptKey,
  encryptSegment,
} from '../upload/crypto.util';

export interface StoredSegment {
  index: number;
  name: string;
  cid: string;
  iv: string;
  duration: number;
}

@Injectable()
export class SegmentEncryptionService {
  generateSegmentKey(): Buffer {
    return crypto.randomBytes(16);
  }

  encryptSegmentData(data: Buffer, key: Buffer) {
    return encryptSegment(data, key);
  }

  decryptSegmentData(encrypted: Buffer, key: Buffer, iv: string) {
    return decryptSegment(encrypted, key, iv);
  }

  wrapSegmentKey(segmentKey: Buffer) {
    return encryptKey(segmentKey);
  }

  unwrapSegmentKey(encryptedKey: string, keyIv: string) {
    return decryptKey(encryptedKey, keyIv);
  }
}
