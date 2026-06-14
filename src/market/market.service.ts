import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateListingDto } from './dto/create-listing.dto';

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
        isActive: true,
        sellerId: userId,
      },
    });
  }

  async getMarketListings() {
    return this.database.listing.findMany({
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
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUserListings(userId: string) {
    return this.database.listing.findMany({
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
      orderBy: {
        createdAt: 'desc',
      },
    });
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
}
