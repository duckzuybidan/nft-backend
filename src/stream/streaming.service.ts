import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UploadService } from '../upload/upload.service';
import {
  SegmentEncryptionService,
  StoredSegment,
} from './segment-encryption.service';
import { PlaybackSessionService } from './playback-session.service';
import { ManifestService } from './manifest.service';
import { AccessService } from './access.service';
import { downloadEncryptedFile } from '../upload/crypto.util';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { configureFfmpeg, toFfmpegPath } from '../common/ffmpeg.config';

@Injectable()
export class StreamingService {
  constructor(
    private database: DatabaseService,
    @Inject(forwardRef(() => UploadService))
    private uploadService: UploadService,
    private segmentEncryption: SegmentEncryptionService,
    private playbackSession: PlaybackSessionService,
    private manifestService: ManifestService,
    private accessService: AccessService,
  ) {}

  async createPlaybackSession(tokenOrFileId: string, userId: string) {
    const fileId = await this.accessService.resolveFileId(tokenOrFileId);
    await this.accessService.assertCanAccess(fileId, userId);

    const profile = await this.database.streamProfile.findUnique({
      where: { fileId },
      include: { file: { include: { metadata: true } } },
    });

    if (!profile) {
      throw new NotFoundException(
        'Streaming profile not found. This file may not be a streamable media type.',
      );
    }

    if (profile.status === 'processing') {
      throw new BadRequestException(
        'Stream is still being processed. Please try again shortly.',
      );
    }

    if (profile.status === 'failed') {
      throw new BadRequestException('Stream processing failed for this file.');
    }

    const session = this.playbackSession.createSession(fileId, userId);
    const baseUrl =
      process.env.API_BASE_URL ||
      `http://localhost:${process.env.PORT ?? 8000}`;

    return {
      ...session,
      fileId,
      manifestUrl: `${baseUrl}/stream/${session.sessionId}/master.m3u8?st=${encodeURIComponent(session.streamToken)}&fileId=${fileId}`,
      mimeType: profile.file.metadata?.mimeType ?? 'application/octet-stream',
    };
  }

  async getStreamStatus(tokenOrFileId: string, userId: string) {
    const fileId = await this.accessService.resolveFileId(tokenOrFileId);
    await this.accessService.assertCanAccess(fileId, userId);

    const profile = await this.database.streamProfile.findUnique({
      where: { fileId },
      select: { status: true, duration: true, updatedAt: true },
    });

    if (!profile) {
      return { fileId, status: 'unavailable' as const };
    }

    return {
      fileId,
      status: profile.status,
      duration: profile.duration,
      updatedAt: profile.updatedAt,
    };
  }

  async getMasterManifest(
    sessionId: string,
    fileId: string,
    streamToken: string,
    origin?: string,
  ) {
    this.playbackSession.validateOrigin(origin);
    const payload = this.playbackSession.verifySessionToken(streamToken);
    this.playbackSession.assertSessionMatchesRoute(payload, sessionId, fileId);
    this.playbackSession.trackRequest(sessionId);

    const profile = await this.getReadyProfile(fileId);
    const segments = this.parseSegments(profile.segments);
    const isAudio = profile.file.metadata?.mimeType?.startsWith('audio/') ?? false;

    return this.manifestService.buildMasterPlaylist(
      sessionId,
      fileId,
      streamToken,
      segments,
      profile.duration ?? 0,
      isAudio,
    );
  }

  async getMediaPlaylist(
    sessionId: string,
    fileId: string,
    streamToken: string,
    origin?: string,
  ) {
    this.playbackSession.validateOrigin(origin);
    const payload = this.playbackSession.verifySessionToken(streamToken);
    this.playbackSession.assertSessionMatchesRoute(payload, sessionId, fileId);
    this.playbackSession.trackRequest(sessionId);

    const profile = await this.getReadyProfile(fileId);
    const segments = this.parseSegments(profile.segments);

    return this.manifestService.buildMediaPlaylist(
      sessionId,
      fileId,
      streamToken,
      segments,
    );
  }

  async getSegment(
    sessionId: string,
    fileId: string,
    segmentName: string,
    streamToken: string,
    origin?: string,
  ) {
    this.playbackSession.validateOrigin(origin);
    const payload = this.playbackSession.verifySessionToken(streamToken);
    this.playbackSession.assertSessionMatchesRoute(payload, sessionId, fileId);
    this.playbackSession.trackRequest(sessionId);

    const profile = await this.getReadyProfile(fileId);
    const segments = this.parseSegments(profile.segments);
    const segment = segments.find((item) => item.name === segmentName);

    if (!segment) {
      throw new NotFoundException('Segment not found');
    }

    if (!profile.segmentKeyEnc || !profile.segmentKeyIv) {
      throw new InternalServerErrorException('Segment key unavailable');
    }

    const segmentKey = this.segmentEncryption.unwrapSegmentKey(
      profile.segmentKeyEnc,
      profile.segmentKeyIv,
    );

    const encryptedBuffer = await downloadEncryptedFile(segment.cid);
    const decrypted = this.segmentEncryption.decryptSegmentData(
      encryptedBuffer,
      segmentKey,
      segment.iv,
    );

    return {
      buffer: decrypted,
      mimeType: 'video/mp2t',
    };
  }

  async processMediaForStreaming(
    fileId: string,
    sourcePath: string,
    mimeType: string,
  ) {
    if (!this.isStreamableMimeType(mimeType)) {
      return;
    }

    await this.database.streamProfile.upsert({
      where: { fileId },
      create: { fileId, status: 'processing' },
      update: { status: 'processing', segments: null, masterPlaylist: null },
    });

    const workDir = path.join(
      path.dirname(sourcePath),
      `hls-${fileId}-${Date.now()}`,
    );

    try {
      fs.mkdirSync(workDir, { recursive: true });

      const playlistPath = path.join(workDir, 'playlist.m3u8');
      const segmentPattern = toFfmpegPath(
        path.join(workDir, 'segment%03d.ts'),
      );

      await this.transcodeToHls(sourcePath, playlistPath, segmentPattern, mimeType);

      const segmentFiles = fs
        .readdirSync(workDir)
        .filter((name) => name.endsWith('.ts'))
        .sort();

      if (segmentFiles.length === 0) {
        throw new Error('FFmpeg produced no HLS segments');
      }

      const segmentKey = this.segmentEncryption.generateSegmentKey();
      const { encryptedKey, keyIv } =
        this.segmentEncryption.wrapSegmentKey(segmentKey);

      const segments: StoredSegment[] = [];
      let totalDuration = 0;

      for (let index = 0; index < segmentFiles.length; index++) {
        const name = segmentFiles[index];
        const segmentPath = path.join(workDir, name);
        const raw = fs.readFileSync(segmentPath);
        const { encrypted, iv } = this.segmentEncryption.encryptSegmentData(
          raw,
          segmentKey,
        );

        const tempEncPath = `${segmentPath}.enc`;
        fs.writeFileSync(tempEncPath, encrypted);
        const cid = await this.uploadService.uploadToPinata(tempEncPath);
        fs.unlinkSync(tempEncPath);

        const duration = await this.probeSegmentDuration(segmentPath);
        totalDuration += duration;

        segments.push({
          index,
          name,
          cid,
          iv,
          duration,
        });
      }

      const masterPlaylist = fs.existsSync(playlistPath)
        ? fs.readFileSync(playlistPath, 'utf8')
        : null;

      await this.database.streamProfile.update({
        where: { fileId },
        data: {
          status: 'ready',
          segments: segments as unknown as object,
          masterPlaylist,
          segmentKeyEnc: encryptedKey,
          segmentKeyIv: keyIv,
          duration: totalDuration,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown streaming error';
      console.error(`[STREAM] Processing failed for ${fileId}:`, message, error);
      await this.database.streamProfile.update({
        where: { fileId },
        data: { status: 'failed' },
      });
    } finally {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  }

  isStreamableMimeType(mimeType: string) {
    return mimeType.startsWith('video/') || mimeType.startsWith('audio/');
  }

  async reprocessFile(tokenOrFileId: string, userId: string) {
    const fileId = await this.accessService.resolveFileId(tokenOrFileId);
    await this.accessService.assertCanAccess(fileId, userId);

    const file = await this.uploadService.getFile(fileId);
    if (!this.isStreamableMimeType(file.mimeType)) {
      throw new BadRequestException('File is not a streamable media type');
    }

    const tempPath = path.join(
      process.cwd(),
      'uploads',
      `reprocess-${fileId}-${Date.now()}${path.extname(file.filename) || '.media'}`,
    );

    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, file.buffer);

    try {
      await this.processMediaForStreaming(fileId, tempPath, file.mimeType);
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }

    return this.getStreamStatus(fileId, userId);
  }

  private async getReadyProfile(fileId: string) {
    const profile = await this.database.streamProfile.findUnique({
      where: { fileId },
      include: { file: { include: { metadata: true } } },
    });

    if (!profile || profile.status !== 'ready') {
      throw new NotFoundException('Stream is not ready');
    }

    return profile;
  }

  private parseSegments(value: unknown): StoredSegment[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value as StoredSegment[];
  }

  private transcodeToHls(
    inputPath: string,
    playlistPath: string,
    segmentPattern: string,
    mimeType: string,
  ): Promise<void> {
    configureFfmpeg();
    const isAudio = mimeType.startsWith('audio/');

    return new Promise((resolve, reject) => {
      const command = ffmpeg(toFfmpegPath(inputPath))
        .outputOptions([
          '-f hls',
          '-hls_time 6',
          '-hls_playlist_type vod',
          '-hls_segment_filename',
          segmentPattern,
          '-hls_flags independent_segments',
        ]);

      if (isAudio) {
        command.outputOptions([
          '-vn',
          '-c:a aac',
          '-b:a 128k',
          '-ac 2',
        ]);
      } else {
        command.outputOptions([
          '-c:v libx264',
          '-preset veryfast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
        ]);
      }

      command
        .output(toFfmpegPath(playlistPath))
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  private probeSegmentDuration(segmentPath: string): Promise<number> {
    configureFfmpeg();
    return new Promise((resolve) => {
      ffmpeg.ffprobe(toFfmpegPath(segmentPath), (err, metadata) => {
        if (err) {
          resolve(6);
          return;
        }
        resolve(metadata.format.duration ?? 6);
      });
    });
  }
}
