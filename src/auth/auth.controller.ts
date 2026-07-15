import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { NonceDto } from './dto/nonce.dto';
import { VerifyDto } from './dto/verify.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('nonce')
  async getNonce(@Body() dto: NonceDto) {
    return this.authService.generateNonce({
      address: dto.address,
    });
  }

  @Post('verify')
  async verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignature({
      address: dto.address,
      message: dto.message,
      signature: dto.signature,
    });
  }

  @Post('sync-ownership')
  @UseGuards(AuthGuard)
  async syncOwnership(@Req() req: Request & { user: { sub: string; address: string } }) {
    return this.authService.syncOwnership(req.user.sub, req.user.address);
  }
}
