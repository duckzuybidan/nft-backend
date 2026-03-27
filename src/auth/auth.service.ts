import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ethers } from 'ethers';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { NonceDto } from './dto/nonce.dto';
import { VerifyDto } from './dto/verify.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async generateNonce({ address }: NonceDto) {
    const nonce = Math.floor(Math.random() * 1000000).toString();

    const user = await this.prisma.user.findUnique({
      where: { walletAddress: address },
    });

    if (!user) {
      await this.prisma.user.create({
        data: {
          walletAddress: address,
          nonce,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { walletAddress: address },
        data: { nonce },
      });
    }

    return { nonce };
  }

  async verifySignature({ address, message, signature }: VerifyDto) {
    const user = await this.prisma.user.findUnique({
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

    await this.prisma.user.update({
      where: { walletAddress: address },
      data: { nonce: '' },
    });

    const payload = { address };

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }
}
