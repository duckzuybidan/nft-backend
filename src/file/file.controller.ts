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
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileService } from './file.service';
import { AuthGuard } from '../auth/auth.guard';
import type { Request, Response } from 'express';
import { UpdateFileDto } from './dto/update-file.dto';

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

@Controller('file')
@UseGuards(AuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('/by-user-id/:userId')
  async getUserFileMetadata(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: parsedPage, limit: parsedLimit } = parsePagination(
      page,
      limit,
    );
    return this.fileService.getUserFileMetadata(
      userId,
      parsedPage,
      parsedLimit,
    );
  }

  @Get('/my-files')
  async getMyFileMetadata(
    @Req() req: Request & { user: { sub: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: parsedPage, limit: parsedLimit } = parsePagination(
      page,
      limit,
    );
    return this.fileService.getUserFileMetadata(
      req.user.sub,
      parsedPage,
      parsedLimit,
    );
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

  @Get('open/:id/:page')
  async openFilePage(
    @Param('id') id: string,
    @Param('page') page: string,
    @Req() req: Request & { user: { sub: string } },
    @Res() res: Response,
  ) {
    const pageNumber = parseInt(page, 10);
    if (isNaN(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('Invalid page number');
    }

    const { buffer, filename, mimeType, totalPages, currentPage } =
      await this.fileService.getFilePage(id, pageNumber, req.user.sub);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Total-Pages', String(totalPages));
    res.setHeader('X-Current-Page', String(currentPage));
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
