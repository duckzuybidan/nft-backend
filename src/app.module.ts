import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';

import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UploadModule } from './upload/upload.module';
import { FileModule } from './file/file.module';
import { MarketModule } from './market/market.module';
import { StreamModule } from './stream/stream.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    CacheModule.register({
      isGlobal: true,
      ttl: 300000,
    }),

    AuthModule,
    DatabaseModule,
    UploadModule,
    FileModule,
    MarketModule,
    StreamModule,
  ],
})
export class AppModule {}
