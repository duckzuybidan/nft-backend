import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UploadService } from '../upload/upload.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export enum ContentType {
  VIDEO = 0,
  IMAGE = 1,
  AUDIO = 2,
  EBOOK = 3,
  SOFTWARE = 4,
  OTHER = 5,
}

@Injectable()
export class MarketService {
  constructor(
    private database: DatabaseService,
    private uploadService: UploadService,
  ) {}

  async createNftMetadata(userId: string, fileId: string) {
    const file = await this.database.file.findUnique({
      where: { id: fileId },
      include: { metadata: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    const fileName = file.metadata?.fileName || `file-${fileId}`;
    const mimeType = file.metadata?.mimeType || 'application/octet-stream';
    const previewImage = file.metadata?.previewImage || undefined;
    const contentType = this.resolveContentType(mimeType);
    const contentHash = `0x${createHash('sha256').update(file.cid).digest('hex')}`;

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const metadata = {
      name: fileName,
      description: `NFT-protected digital asset: ${fileName}`,
      image: previewImage,
      external_url: `${clientUrl}/files/${fileId}`,
      fileId,
      attributes: [
        { trait_type: 'fileId', value: fileId },
        { trait_type: 'mimeType', value: mimeType },
        { trait_type: 'size', value: file.metadata?.size ?? 0 },
        { trait_type: 'contentType', value: ContentType[contentType] },
        { trait_type: 'contentCid', value: file.cid },
      ],
      properties: {
        fileId,
        mimeType,
        cid: file.cid,
      },
    };

    const metadataCid = await this.uploadService.uploadJsonToPinata(
      metadata,
      `nft-metadata-${fileId}`,
    );
    const metadataURI = this.uploadService.getGatewayUrl(metadataCid);

    return {
      metadataURI,
      metadataCid,
      contentHash,
      contentType,
      title: fileName,
      mimeType,
      previewImage,
    };
  }

  private resolveContentType(mimeType: string): ContentType {
    if (mimeType.startsWith('video/')) return ContentType.VIDEO;
    if (mimeType.startsWith('image/')) return ContentType.IMAGE;
    if (mimeType.startsWith('audio/')) return ContentType.AUDIO;
    if (
      mimeType === 'application/pdf' ||
      mimeType.includes('ebook') ||
      mimeType.includes('epub')
    ) {
      return ContentType.EBOOK;
    }
    if (
      mimeType.includes('javascript') ||
      mimeType.includes('zip') ||
      mimeType.includes('octet-stream')
    ) {
      return ContentType.SOFTWARE;
    }
    return ContentType.OTHER;
  }

  async listFile(userId: string, dto: CreateListingDto) {
    const file = await this.database.file.findUnique({
      where: { id: dto.fileId },
      include: { listing: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    if (file.listing && file.listing.isActive) {
      throw new BadRequestException('File is already listed');
    }

    if (!dto.hirePrice && !dto.buyPrice) {
      throw new BadRequestException(
        'At least one price (hire or buy) must be provided',
      );
    }

    return this.database.listing.upsert({
      where: { fileId: dto.fileId },
      update: {
        hirePrice: dto.hirePrice,
        buyPrice: dto.buyPrice,
        tokenId: dto.tokenId,
        isActive: true,
        sellerId: userId,
      },
      create: {
        fileId: dto.fileId,
        hirePrice: dto.hirePrice,
        buyPrice: dto.buyPrice,
        tokenId: dto.tokenId,
        isActive: true,
        sellerId: userId,
      },
    });
  }

  async getMarketListings(
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ) {
    let parsedPage = page < 1 ? DEFAULT_PAGE : page;
    let parsedLimit = limit < 1 ? DEFAULT_LIMIT : limit;
    parsedLimit = parsedLimit > MAX_LIMIT ? MAX_LIMIT : parsedLimit;

    const skip = (parsedPage - 1) * parsedLimit;

    const [listings, total] = await Promise.all([
      this.database.listing.findMany({
        where: { isActive: true },
        include: {
          file: {
            select: {
              id: true,
              cid: true,
              createdAt: true,
              userId: true,
              metadata: true,
              user: {
                select: {
                  walletAddress: true,
                },
              },
            },
          },
        },
        skip,
        take: parsedLimit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.database.listing.count({ where: { isActive: true } }),
    ]);

    return {
      data: listings,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
    };
  }

  async getUserListings(
    userId: string,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ) {
    let parsedPage = page < 1 ? DEFAULT_PAGE : page;
    let parsedLimit = limit < 1 ? DEFAULT_LIMIT : limit;
    parsedLimit = parsedLimit > MAX_LIMIT ? MAX_LIMIT : parsedLimit;

    const skip = (parsedPage - 1) * parsedLimit;

    const [listings, total] = await Promise.all([
      this.database.listing.findMany({
        where: {
          sellerId: userId,
          isActive: true,
        },
        include: {
          file: {
            select: {
              id: true,
              cid: true,
              createdAt: true,
              userId: true,
              metadata: true,
            },
          },
        },
        skip,
        take: parsedLimit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.database.listing.count({
        where: {
          sellerId: userId,
          isActive: true,
        },
      }),
    ]);

    return {
      data: listings,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
    };
  }

  async updateListing(
    userId: string,
    listingId: string,
    dto: Partial<CreateListingDto>,
  ) {
    const listing = await this.database.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    if (listing.sellerId !== userId) {
      throw new UnauthorizedException('You do not own this listing');
    }

    const hirePrice =
      dto.hirePrice !== undefined ? dto.hirePrice : listing.hirePrice;
    const buyPrice =
      dto.buyPrice !== undefined ? dto.buyPrice : listing.buyPrice;

    if (!hirePrice && !buyPrice) {
      throw new BadRequestException(
        'A listing must have at least one price (hire or buy)',
      );
    }

    return this.database.listing.update({
      where: { id: listingId },
      data: {
        hirePrice,
        buyPrice,
      },
    });
  }

  async getListingById(id: string) {
    const listing = await this.database.listing.findUnique({
      where: { id, isActive: true },
      include: {
        file: {
          select: {
            id: true,
            cid: true,
            createdAt: true,
            userId: true,
            metadata: true,
            user: {
              select: {
                walletAddress: true,
              },
            },
          },
        },
      },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    return listing;
  }

  async removeListing(userId: string, listingId: string) {
    const listing = await this.database.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    if (listing.sellerId !== userId) {
      throw new UnauthorizedException('You do not own this listing');
    }

    return this.database.listing.update({
      where: { id: listingId },
      data: { isActive: false },
    });
  }

  async buyFile(userId: string, listingId: string) {
    const listing = await this.database.listing.findUnique({
      where: { id: listingId },
      include: { file: true },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    if (!listing.isActive) {
      throw new BadRequestException('Listing is not active');
    }

    if (!listing.buyPrice) {
      throw new BadRequestException('This listing is not for sale');
    }

    if (listing.sellerId === userId) {
      throw new BadRequestException('You cannot buy your own listing');
    }

    // Mark listing as inactive
    const updatedListing = await this.database.listing.update({
      where: { id: listingId },
      data: { isActive: false },
      include: { file: true },
    });

    // Transfer file ownership to the buyer
    await this.database.file.update({
      where: { id: listing.fileId },
      data: { userId: userId },
    });

    return updatedListing;
  }
}
