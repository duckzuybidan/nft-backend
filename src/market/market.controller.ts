import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Patch,
  Query,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parsePagination(
  page?: string,
  limit?: string,
): { page: number; limit: number } {
  let parsedPage = page ? parseInt(page, 10) : DEFAULT_PAGE;
  let parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;

  if (isNaN(parsedPage) || parsedPage < 1) {
    parsedPage = DEFAULT_PAGE;
  }

  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = DEFAULT_LIMIT;
  }

  if (parsedLimit > MAX_LIMIT) {
    parsedLimit = MAX_LIMIT;
  }

  return { page: parsedPage, limit: parsedLimit };
}

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get()
  async getMarketListings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: parsedPage, limit: parsedLimit } = parsePagination(
      page,
      limit,
    );
    return this.marketService.getMarketListings(parsedPage, parsedLimit);
  }

  @Get('listing/:id')
  async getListingById(@Param('id') id: string) {
    return this.marketService.getListingById(id);
  }

  @Get('my-listings')
  @UseGuards(AuthGuard)
  async getMyListings(
    @Req() req: Request & { user: { sub: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: parsedPage, limit: parsedLimit } = parsePagination(
      page,
      limit,
    );
    return this.marketService.getUserListings(
      req.user.sub,
      parsedPage,
      parsedLimit,
    );
  }

  @Post('list')
  @UseGuards(AuthGuard)
  async listFile(
    @Req() req: Request & { user: { sub: string } },
    @Body() dto: CreateListingDto,
  ) {
    return this.marketService.listFile(req.user.sub, dto);
  }

  @Patch('listing/:id')
  @UseGuards(AuthGuard)
  async updateListing(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: Partial<CreateListingDto>,
  ) {
    return this.marketService.updateListing(req.user.sub, id, dto);
  }

  @Delete('listing/:id')
  @UseGuards(AuthGuard)
  async removeListing(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.marketService.removeListing(req.user.sub, id);
  }

  @Post('listing/:id/buy')
  @UseGuards(AuthGuard)
  async buyFile(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.marketService.buyFile(req.user.sub, id);
  }
}
