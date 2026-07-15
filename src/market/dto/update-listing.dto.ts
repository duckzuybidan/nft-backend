import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateListingDto {
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

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
