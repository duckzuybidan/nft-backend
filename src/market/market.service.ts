import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

@Injectable()
export class MarketService {
  constructor(private database: DatabaseService) {}

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

    const where = { sellerId: userId };

    const [listings, total] = await Promise.all([
      this.database.listing.findMany({
        where,
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
      this.database.listing.count({ where }),
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
    dto: UpdateListingDto,
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

    if (
      dto.hirePrice === undefined &&
      dto.buyPrice === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException(
        'At least one field (hirePrice, buyPrice, or isActive) must be provided',
      );
    }

    const hirePrice =
      dto.hirePrice !== undefined ? dto.hirePrice : listing.hirePrice;
    const buyPrice =
      dto.buyPrice !== undefined ? dto.buyPrice : listing.buyPrice;
    const isActive =
      dto.isActive !== undefined ? dto.isActive : listing.isActive;

    if (isActive && !hirePrice && !buyPrice) {
      throw new BadRequestException(
        'An active listing must have at least one price (hire or buy)',
      );
    }

    return this.database.listing.update({
      where: { id: listingId },
      data: {
        ...(dto.hirePrice !== undefined && { hirePrice: dto.hirePrice }),
        ...(dto.buyPrice !== undefined && { buyPrice: dto.buyPrice }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
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
