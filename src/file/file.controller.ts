import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FileService } from './file.service';
import { AuthGuard } from '../auth/auth.guard';
import type { Request, Response } from 'express';
import { UpdateFileDto } from './dto/update-file.dto';

@Controller('file')
@UseGuards(AuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('/by-user-id/:userId')
  async getUserFileMetadata(@Param('userId') userId: string) {
    return this.fileService.getUserFileMetadata(userId);
  }

  @Get('/my-files')
  async getMyFileMetadata(@Req() req: Request & { user: { sub: string } }) {
    return this.fileService.getUserFileMetadata(req.user.sub);
  }

  @Get('open/:id')
  async openFile(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
    @Res() res: Response,
  ) {
    const { buffer, filename, mimeType } = await this.fileService.openFile(
      id,
      req.user.sub,
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @Patch(':id')
  async updateFile(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
    @Body() dto: UpdateFileDto,
  ) {
    return this.fileService.updateFileMetadata(id, req.user.sub, dto);
  }

  @Delete(':id')
  async deleteFile(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.fileService.deleteFile(id, req.user.sub);
  }
}
