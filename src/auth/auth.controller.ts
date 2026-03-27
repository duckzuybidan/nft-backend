import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
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
}
