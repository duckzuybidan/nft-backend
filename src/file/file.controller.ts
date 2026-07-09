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

  @Get('/:id/metadata')
  async getFileMetadata(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.fileService.getFileMetadata(id, req.user.sub);
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

  @Get('stream/:id')
  async streamFile(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
    @Res() res: Response,
  ) {
    const { stream, filename, mimeType, size } =
      await this.fileService.streamFile(id, req.user.sub);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    if (!size) {
      stream.pipe(res);
      return;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 0 ||
        end >= size ||
        start > end
      ) {
        res.status(416).header('Content-Range', `bytes */${size}`).send();
        return;
      }

      const contentLength = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', contentLength.toString());

      let bytesSent = 0;
      stream.on('data', (chunk) => {
        const chunkBuffer = chunk as Buffer;
        let chunkStart = 0;
        let chunkEnd = chunkBuffer.length;

        if (bytesSent + chunkBuffer.length <= start) {
          bytesSent += chunkBuffer.length;
          return;
        }

        if (bytesSent < start) {
          chunkStart = start - bytesSent;
          bytesSent = start;
        }

        const remaining = end - bytesSent + 1;
        if (chunkEnd - chunkStart > remaining) {
          chunkEnd = chunkStart + remaining;
        }

        res.write(chunkBuffer.subarray(chunkStart, chunkEnd));
        bytesSent += chunkEnd - chunkStart;

        if (bytesSent > end) {
          stream.destroy();
          res.end();
        }
      });

      stream.on('end', () => {
        if (!res.writableEnded) {
          res.end();
        }
      });

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.writableEnded) {
          res.end();
        }
      });
    } else {
      res.setHeader('Content-Length', size.toString());
      stream.pipe(res);
    }
  }

  @Delete(':id')
  async deleteFile(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.fileService.deleteFile(id, req.user.sub);
  }
}
