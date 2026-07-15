import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.service';
import { BlockchainService } from '../blockchain/blockchain.service';

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;
const OWNER_OF_BATCH = 8;

export interface SyncOwnershipResult {
  synced: boolean;
  claimed: number;
  listingsUpdated: number;
  accessGrants: number;
  scanned: number;
  skipped: boolean;
  message?: string;
}

@Injectable()
export class OwnershipSyncService {
  private readonly logger = new Logger(OwnershipSyncService.name);
  private readonly inFlight = new Map<string, Promise<SyncOwnershipResult>>();

  constructor(
    private database: DatabaseService,
    private blockchain: BlockchainService,
  ) {}

  async syncWalletOwnership(
    userId: string,
    walletAddress: string,
  ): Promise<SyncOwnershipResult> {
    const key = `${userId}:${walletAddress.toLowerCase()}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.runSync(userId, walletAddress).finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Fire-and-forget sync used during login verify so JWT returns immediately. */
  syncInBackground(userId: string, walletAddress: string) {
    void this.syncWalletOwnership(userId, walletAddress).catch((error) => {
      this.logger.error(
        `Background ownership sync failed for ${walletAddress}: ${error}`,
      );
    });
  }

  private async runSync(
    userId: string,
    walletAddress: string,
  ): Promise<SyncOwnershipResult> {
    if (!this.blockchain.isConfigured()) {
      return {
        synced: false,
        claimed: 0,
        listingsUpdated: 0,
        accessGrants: 0,
        scanned: 0,
        skipped: true,
        message: 'Blockchain sync is not configured',
      };
    }

    const wallet = walletAddress.toLowerCase();
    let claimed = 0;
    let listingsUpdated = 0;
    let accessGrants = 0;
    let scanned = 0;

    const listings = await this.database.listing.findMany({
      where: { tokenId: { not: null } },
      include: {
        file: { select: { id: true, userId: true } },
      },
    });

    const processedTokenIds = new Set<string>();

    for (const batch of this.chunk(listings, OWNER_OF_BATCH)) {
      const owners = await Promise.all(
        batch.map(async (listing) => ({
          listing,
          owner: listing.tokenId
            ? await this.blockchain.ownerOf(listing.tokenId)
            : null,
        })),
      );

      for (const { listing, owner } of owners) {
        if (!listing.tokenId) continue;
        processedTokenIds.add(listing.tokenId);
        scanned += 1;

        if (owner === wallet) {
          const result = await this.claimFileOwnership(
            listing.fileId,
            userId,
            listing.file.userId,
          );
          if (result) claimed += 1;

          if (listing.isActive && listing.sellerId !== userId) {
            await this.database.listing.update({
              where: { id: listing.id },
              data: { isActive: false },
            });
            listingsUpdated += 1;
          }
        }

        if (this.blockchain.hasAccessTokenContract()) {
          const granted = await this.syncAccessGrant(
            userId,
            wallet,
            listing.fileId,
            listing.tokenId,
            owner === wallet,
          );
          if (granted) accessGrants += 1;
        }
      }
    }

    const totalSupply = Number(await this.blockchain.getTotalSupply());
    const unknownIds: number[] = [];
    for (let id = 1; id <= totalSupply; id += 1) {
      if (!processedTokenIds.has(String(id))) {
        unknownIds.push(id);
      }
    }

    for (const batch of this.chunk(unknownIds, OWNER_OF_BATCH)) {
      const results = await Promise.all(
        batch.map(async (tokenId) => {
          const owner = await this.blockchain.ownerOf(tokenId);
          if (owner !== wallet) {
            return null;
          }
          const uri = await this.blockchain.tokenURI(tokenId);
          const fileId = await this.resolveFileIdFromUri(uri);
          return fileId ? { tokenId, fileId } : null;
        }),
      );

      for (const item of results) {
        scanned += 1;
        if (!item) continue;

        const file = await this.database.file.findUnique({
          where: { id: item.fileId },
          select: { id: true, userId: true, listing: true },
        });

        if (!file) {
          this.logger.warn(
            `On-chain token ${item.tokenId} maps to missing file ${item.fileId}`,
          );
          continue;
        }

        const result = await this.claimFileOwnership(
          file.id,
          userId,
          file.userId,
        );
        if (result) claimed += 1;

        if (!file.listing) {
          await this.database.listing.create({
            data: {
              fileId: file.id,
              tokenId: String(item.tokenId),
              isActive: false,
              sellerId: userId,
            },
          });
          listingsUpdated += 1;
        } else if (!file.listing.tokenId) {
          await this.database.listing.update({
            where: { id: file.listing.id },
            data: { tokenId: String(item.tokenId) },
          });
          listingsUpdated += 1;
        }

        if (this.blockchain.hasAccessTokenContract()) {
          const granted = await this.syncAccessGrant(
            userId,
            wallet,
            file.id,
            String(item.tokenId),
            true,
          );
          if (granted) accessGrants += 1;
        }
      }
    }

    this.logger.log(
      `Ownership sync for ${wallet}: claimed=${claimed}, listings=${listingsUpdated}, access=${accessGrants}, scanned=${scanned}`,
    );

    return {
      synced: true,
      claimed,
      listingsUpdated,
      accessGrants,
      scanned,
      skipped: false,
    };
  }

  private async claimFileOwnership(
    fileId: string,
    userId: string,
    currentUserId: string,
  ): Promise<boolean> {
    if (currentUserId === userId) {
      return false;
    }

    await this.database.file.update({
      where: { id: fileId },
      data: { userId },
    });

    return true;
  }

  private async syncAccessGrant(
    userId: string,
    wallet: string,
    fileId: string,
    tokenId: string,
    isOwner: boolean,
  ): Promise<boolean> {
    if (isOwner) {
      await this.database.accessGrant.deleteMany({
        where: { userId, fileId },
      });
      return false;
    }

    const balance = await this.blockchain.balanceOfAccess(wallet, tokenId);
    const canAccess =
      balance > 0n || (await this.blockchain.canAccess(wallet, tokenId));

    if (!canAccess) {
      await this.database.accessGrant.deleteMany({
        where: { userId, fileId },
      });
      return false;
    }

    await this.database.accessGrant.upsert({
      where: {
        userId_fileId: { userId, fileId },
      },
      create: {
        userId,
        fileId,
        tokenId,
        balance: Number(balance > 0n ? balance : 1n),
      },
      update: {
        tokenId,
        balance: Number(balance > 0n ? balance : 1n),
      },
    });

    return true;
  }

  private async resolveFileIdFromUri(uri: string | null): Promise<string | null> {
    if (!uri) return null;

    const direct = this.extractFileId(uri);
    if (direct) {
      return direct;
    }

    // Real metadata URIs point at JSON that embeds fileId.
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      try {
        const response = await axios.get(uri, { timeout: 10_000 });
        const data = response.data as {
          fileId?: string;
          properties?: { fileId?: string };
          attributes?: Array<{ trait_type?: string; value?: unknown }>;
        };

        if (data.fileId && OBJECT_ID_REGEX.test(data.fileId)) {
          return data.fileId;
        }

        if (
          data.properties?.fileId &&
          OBJECT_ID_REGEX.test(data.properties.fileId)
        ) {
          return data.properties.fileId;
        }

        const attr = data.attributes?.find(
          (item) => item.trait_type === 'fileId',
        );
        if (
          attr &&
          typeof attr.value === 'string' &&
          OBJECT_ID_REGEX.test(attr.value)
        ) {
          return attr.value;
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch metadata URI ${uri}: ${error}`);
      }
    }

    return null;
  }

  private extractFileId(uri: string | null): string | null {
    if (!uri) return null;

    const trimmed = uri.trim();
    if (OBJECT_ID_REGEX.test(trimmed)) {
      return trimmed;
    }

    const lastSegment = trimmed.split('/').pop()?.split('?')[0];
    if (lastSegment && OBJECT_ID_REGEX.test(lastSegment)) {
      return lastSegment;
    }

    return null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}
