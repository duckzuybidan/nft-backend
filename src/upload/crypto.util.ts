import axios from 'axios';
import * as crypto from 'crypto';

const MASTER_KEY = Buffer.from(process.env.MASTER_KEY!, 'hex');

export function encryptKey(key: Buffer) {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', MASTER_KEY, iv);

  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);

  return {
    encryptedKey: encrypted.toString('hex'),
    keyIv: iv.toString('hex'),
  };
}

export function decryptKey(encryptedKey: string, keyIv: string) {
  const masterKey = Buffer.from(process.env.MASTER_KEY!, 'hex');

  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    masterKey,
    Buffer.from(keyIv, 'hex'),
  );

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'hex')),
    decipher.final(),
  ]);

  return decrypted;
}

export async function downloadEncryptedFile(cid: string) {
  const url = `https://gateway.pinata.cloud/ipfs/${cid}`;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
}

export function decryptFile(
  encryptedBuffer: Buffer,
  aesKey: Buffer,
  iv: string,
) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    aesKey,
    Buffer.from(iv, 'hex'),
  );

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  return decrypted;
}
