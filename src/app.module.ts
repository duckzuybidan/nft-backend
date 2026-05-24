import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { UploadModule } from './upload/upload.module';
import { UserModule } from './user/user.module';
import { MarketModule } from './market/market.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    DatabaseModule,
    UploadModule,
    UserModule,
    MarketModule,
  ],
})
export class AppModule {}
