import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShareMemberDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsNumber()
  @Min(0)
  ratio: number;
}

export class CreateShareGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareMemberDto)
  members: ShareMemberDto[];
}
