import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateFileDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  fileName?: string;
}
