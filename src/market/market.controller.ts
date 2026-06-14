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
} from '@nestjs/common';
import { MarketService } from './market.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get()
  async getMarketListings() {
    return this.marketService.getMarketListings();
  }

  @Get('my-listings')
  @UseGuards(AuthGuard)
  async getMyListings(@Req() req: Request & { user: { sub: string } }) {
    return this.marketService.getUserListings(req.user.sub);
  }

  @Post('list')
  @UseGuards(AuthGuard)
  async listFile(
    @Req() req: Request & { user: { sub: string } },
    @Body() dto: CreateListingDto,
  ) {
    console.log(dto);
    console.log(typeof dto.hirePrice);
    console.log(typeof dto.buyPrice);
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
}
