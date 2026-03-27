import { IsEthereumAddress } from 'class-validator';

export class NonceDto {

  @IsEthereumAddress()
  address: string;

}