import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ethers } from 'ethers';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { NonceDto } from './dto/nonce.dto';
import { VerifyDto } from './dto/verify.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private database: DatabaseService,
  ) {}

  async generateNonce({ address }: NonceDto) {
    const nonce = Math.floor(Math.random() * 1000000).toString();

    const user = await this.database.user.findUnique({
      where: { walletAddress: address },
    });

    if (!user) {
      await this.database.user.create({
        data: {
          walletAddress: address,
          nonce,
        },
      });
    } else {
      await this.database.user.update({
        where: { walletAddress: address },
        data: { nonce },
      });
    }

    return { nonce };
  }

  async verifySignature({ address, message, signature }: VerifyDto) {
    const user = await this.database.user.findUnique({
      where: { walletAddress: address },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      throw new UnauthorizedException('Invalid signature');
    }

    if (!message.includes(user.nonce)) {
      throw new UnauthorizedException('Invalid nonce');
    }

    await this.database.user.update({
      where: { walletAddress: address },
      data: { nonce: '' },
    });

    const payload = { sub: user.id, address };

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }
}
