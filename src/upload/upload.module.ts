import { Module, forwardRef } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { AuthModule } from '../auth/auth.module';
import { StreamModule } from '../stream/stream.module';

@Module({
  imports: [AuthModule, forwardRef(() => StreamModule)],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
