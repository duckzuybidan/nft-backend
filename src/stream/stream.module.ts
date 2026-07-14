import { Module, forwardRef } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamingService } from './streaming.service';
import { SegmentEncryptionService } from './segment-encryption.service';
import { PlaybackSessionService } from './playback-session.service';
import { ManifestService } from './manifest.service';
import { AccessService } from './access.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [DatabaseModule, AuthModule, forwardRef(() => UploadModule)],
  controllers: [StreamController],
  providers: [
    StreamingService,
    SegmentEncryptionService,
    PlaybackSessionService,
    ManifestService,
    AccessService,
  ],
  exports: [StreamingService],
})
export class StreamModule {}
