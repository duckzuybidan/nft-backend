import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoredSegment } from './segment-encryption.service';

@Injectable()
export class ManifestService {
  constructor(private configService: ConfigService) {}

  private getBaseUrl() {
    return (
      this.configService.get<string>('API_BASE_URL') ||
      `http://localhost:${this.configService.get<string>('PORT') ?? 8000}`
    );
  }

  buildMasterPlaylist(
    sessionId: string,
    fileId: string,
    streamToken: string,
    segments: StoredSegment[],
    duration: number,
    isAudio: boolean,
  ): string {
    const base = this.getBaseUrl();
    const tokenParam = encodeURIComponent(streamToken);
    const mediaPlaylistUrl = `${base}/stream/${sessionId}/playlist.m3u8?st=${tokenParam}&fileId=${fileId}`;

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-STREAM-INF:BANDRATE=0,CODECS="${isAudio ? 'mp4a.40.2' : 'avc1.42E01E,mp4a.40.2'}"`,
      mediaPlaylistUrl,
    ];

    if (segments.length === 0) {
      lines.push(
        `#EXT-X-TARGETDURATION:${Math.ceil(duration || 6)}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-ENDLIST',
      );
    }

    return lines.join('\n') + '\n';
  }

  buildMediaPlaylist(
    sessionId: string,
    fileId: string,
    streamToken: string,
    segments: StoredSegment[],
  ): string {
    const base = this.getBaseUrl();
    const tokenParam = encodeURIComponent(streamToken);
    const maxDuration = Math.max(
      6,
      ...segments.map((segment) => Math.ceil(segment.duration)),
    );

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXT-X-TARGETDURATION:${maxDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];

    for (const segment of segments) {
      lines.push(
        `#EXTINF:${segment.duration.toFixed(3)},`,
        `${base}/stream/${sessionId}/${segment.name}?st=${tokenParam}&fileId=${fileId}`,
      );
    }

    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
  }
}
