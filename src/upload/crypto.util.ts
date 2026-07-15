import axios from 'axios';
import * as crypto from 'crypto';

function getMasterKey() {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    throw new Error('MASTER_KEY environment variable is not defined');
  }
  return Buffer.from(masterKey, 'hex');
}

export function encryptKey(key: Buffer) {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', getMasterKey(), iv);

  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);

  return {
    encryptedKey: encrypted.toString('hex'),
    keyIv: iv.toString('hex'),
  };
}

export function decryptKey(encryptedKey: string, keyIv: string) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    getMasterKey(),
    Buffer.from(keyIv, 'hex'),
  );

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'hex')),
    decipher.final(),
  ]);

  return decrypted;
}

export function getIpfsGatewayUrl(cid: string) {
  const gateway =
    process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
  return `${gateway}${cid}`;
}

export async function downloadEncryptedFile(cid: string) {
  const url = getIpfsGatewayUrl(cid);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
}

export function encryptSegment(data: Buffer, key: Buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return { encrypted, iv: iv.toString('hex') };
}

export function decryptSegment(
  encryptedBuffer: Buffer,
  key: Buffer,
  iv: string,
) {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    key,
    Buffer.from(iv, 'hex'),
  );
  return Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);
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
