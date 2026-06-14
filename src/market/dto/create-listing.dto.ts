import {
  IsNumber,
  IsString,
  IsNotEmpty,
  Min,
  IsOptional,
} from 'class-validator';

import { Type } from 'class-transformer';

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  fileId: string;

  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hirePrice?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  buyPrice?: number;
}
