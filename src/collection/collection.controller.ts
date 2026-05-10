import { Controller, Get, Param } from '@nestjs/common';
import { CollectionService } from './collection.service';

@Controller('collection')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get('user/:userId')
  async getFilesByUserId(@Param('userId') userId: string) {
    return this.collectionService.getFilesByUserId(userId);
  }
}
