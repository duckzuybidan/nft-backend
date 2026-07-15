import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StringValue } from 'ms';
import { AuthGuard } from './auth.guard';
import { OwnershipSyncService } from './ownership-sync.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    ConfigModule,
    BlockchainModule,

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<StringValue>('JWT_EXPIRE'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OwnershipSyncService],
  exports: [AuthGuard, JwtModule, OwnershipSyncService],
})
export class AuthModule {}
