import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface PlaybackSessionPayload {
  sid: string;
  fileId: string;
  userId: string;
  type: 'playback';
}

interface SessionRateState {
  count: number;
  windowStart: number;
}

const SESSION_TTL_SECONDS = 600;
const MAX_REQUESTS_PER_SESSION = 500;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;

@Injectable()
export class PlaybackSessionService {
  private readonly rateLimits = new Map<string, SessionRateState>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  createSession(fileId: string, userId: string) {
    const sessionId = randomUUID();
    const payload: PlaybackSessionPayload = {
      sid: sessionId,
      fileId,
      userId,
      type: 'playback',
    };

    const streamToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: SESSION_TTL_SECONDS,
    });

    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    return {
      sessionId,
      streamToken,
      expiresAt: expiresAt.toISOString(),
      expiresIn: SESSION_TTL_SECONDS,
    };
  }

  verifySessionToken(token: string): PlaybackSessionPayload {
    try {
      const payload = this.jwtService.verify<PlaybackSessionPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });

      if (payload.type !== 'playback' || !payload.sid || !payload.fileId) {
        throw new UnauthorizedException('Invalid playback session');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Playback session expired or invalid');
    }
  }

  assertSessionMatchesRoute(
    payload: PlaybackSessionPayload,
    sessionId: string,
    fileId: string,
  ) {
    if (payload.sid !== sessionId) {
      throw new ForbiddenException('Session mismatch');
    }

    if (payload.fileId !== fileId) {
      throw new ForbiddenException('File access denied for this session');
    }
  }

  trackRequest(sessionId: string) {
    const now = Date.now();
    const state = this.rateLimits.get(sessionId) ?? {
      count: 0,
      windowStart: now,
    };

    if (now - state.windowStart > RATE_WINDOW_MS) {
      state.count = 0;
      state.windowStart = now;
    }

    state.count += 1;
    this.rateLimits.set(sessionId, state);

    if (state.count > MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        'Segment request rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const totalKey = `${sessionId}:total`;
    const totalState = this.rateLimits.get(totalKey) ?? {
      count: 0,
      windowStart: now,
    };
    totalState.count += 1;
    this.rateLimits.set(totalKey, totalState);

    if (totalState.count > MAX_REQUESTS_PER_SESSION) {
      throw new HttpException(
        'Playback session request limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  validateOrigin(origin: string | undefined) {
    const allowed = this.configService.get<string>('CLIENT_URL');
    if (!allowed || !origin) {
      return;
    }

    if (origin !== allowed) {
      throw new ForbiddenException('Origin not allowed');
    }
  }
}
