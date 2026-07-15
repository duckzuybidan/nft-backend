import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { ACCESS_TOKEN_ABI, CONTENT_NFT_ABI } from './abis';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider | null = null;
  private contentNft: ethers.Contract | null = null;
  private accessToken: ethers.Contract | null = null;

  constructor(private configService: ConfigService) {
    this.initContracts();
  }

  private initContracts() {
    const rpcUrl = this.configService.get<string>('RPC_URL');
    const contentNftAddress = this.configService.get<string>(
      'CONTENT_NFT_ADDRESS',
    );
    const accessTokenAddress = this.configService.get<string>(
      'ACCESS_TOKEN_ADDRESS',
    );

    if (!rpcUrl || !contentNftAddress) {
      this.logger.warn(
        'RPC_URL or CONTENT_NFT_ADDRESS not configured — ownership sync disabled',
      );
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contentNft = new ethers.Contract(
      contentNftAddress,
      CONTENT_NFT_ABI,
      this.provider,
    );

    if (
      accessTokenAddress &&
      !accessTokenAddress.includes('YourAccessToken')
    ) {
      this.accessToken = new ethers.Contract(
        accessTokenAddress,
        ACCESS_TOKEN_ABI,
        this.provider,
      );
    }
  }

  isConfigured() {
    return Boolean(this.contentNft);
  }

  hasAccessTokenContract() {
    return Boolean(this.accessToken);
  }

  async getTotalSupply(): Promise<bigint> {
    if (!this.contentNft) return 0n;
    return this.contentNft.totalSupply() as Promise<bigint>;
  }

  async ownerOf(tokenId: string | number): Promise<string | null> {
    if (!this.contentNft) return null;
    try {
      const owner = (await this.contentNft.ownerOf(BigInt(tokenId))) as string;
      return owner.toLowerCase();
    } catch {
      return null;
    }
  }

  async tokenURI(tokenId: string | number): Promise<string | null> {
    if (!this.contentNft) return null;
    try {
      return (await this.contentNft.tokenURI(BigInt(tokenId))) as string;
    } catch {
      return null;
    }
  }

  async balanceOfAccess(
    wallet: string,
    tokenId: string | number,
  ): Promise<bigint> {
    if (!this.accessToken) return 0n;
    try {
      return (await this.accessToken.balanceOf(
        wallet,
        BigInt(tokenId),
      )) as bigint;
    } catch {
      return 0n;
    }
  }

  async canAccess(wallet: string, tokenId: string | number): Promise<boolean> {
    if (!this.accessToken) return false;
    try {
      return Boolean(await this.accessToken.canAccess(wallet, BigInt(tokenId)));
    } catch {
      return false;
    }
  }
}
