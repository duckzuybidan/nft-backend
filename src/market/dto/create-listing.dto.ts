import {
  IsNumber,
  IsString,
  IsNotEmpty,
  Min,
  IsOptional,
} from 'class-validator';

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  fileId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  hirePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  buyPrice?: number;
}
