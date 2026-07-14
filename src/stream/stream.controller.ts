import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { StreamingService } from './streaming.service';

@Controller('stream')
export class StreamController {
  constructor(private streamingService: StreamingService) {}

  @Post('session/:tokenId')
  @UseGuards(AuthGuard)
  async createSession(
    @Param('tokenId') tokenId: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.streamingService.createPlaybackSession(tokenId, req.user.sub);
  }

  @Get('status/:tokenId')
  @UseGuards(AuthGuard)
  async getStreamStatus(
    @Param('tokenId') tokenId: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.streamingService.getStreamStatus(tokenId, req.user.sub);
  }

  @Post('reprocess/:tokenId')
  @UseGuards(AuthGuard)
  async reprocessFile(
    @Param('tokenId') tokenId: string,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.streamingService.reprocessFile(tokenId, req.user.sub);
  }

  @Get(':sessionId/master.m3u8')
  async getMasterManifest(
    @Param('sessionId') sessionId: string,
    @Query('st') streamToken: string,
    @Query('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const manifest = await this.streamingService.getMasterManifest(
      sessionId,
      fileId,
      streamToken,
      req.headers.origin,
    );

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(manifest);
  }

  @Get(':sessionId/playlist.m3u8')
  async getMediaPlaylist(
    @Param('sessionId') sessionId: string,
    @Query('st') streamToken: string,
    @Query('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const manifest = await this.streamingService.getMediaPlaylist(
      sessionId,
      fileId,
      streamToken,
      req.headers.origin,
    );

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(manifest);
  }

  @Get(':sessionId/:segment')
  async getSegment(
    @Param('sessionId') sessionId: string,
    @Param('segment') segment: string,
    @Query('st') streamToken: string,
    @Query('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!segment.endsWith('.ts')) {
      res.status(404).send('Not found');
      return;
    }

    const { buffer, mimeType } = await this.streamingService.getSegment(
      sessionId,
      fileId,
      segment,
      streamToken,
      req.headers.origin,
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
