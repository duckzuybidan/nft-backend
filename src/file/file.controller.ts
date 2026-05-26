import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('/by-user-id/:userId')
  async getUserFileMetadata(@Param('userId') userId: string) {
    return this.fileService.getUserFileMetadata(userId);
  }

  @Get('/my-files')
  @UseGuards(AuthGuard)
  async getMyFileMetadata(@Req() req: Request & { user: { sub: string } }) {
    return this.fileService.getUserFileMetadata(req.user.sub);
  }
}
