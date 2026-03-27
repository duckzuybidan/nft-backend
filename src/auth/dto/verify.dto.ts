import { IsEthereumAddress, IsString } from 'class-validator';

export class VerifyDto {
  @IsEthereumAddress()
  address: string;

  @IsString()
  signature: string;

  @IsString()
  message: string;
}
