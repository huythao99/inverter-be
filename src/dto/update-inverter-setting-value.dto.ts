import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateInverterSettingValueDto {
  @IsString()
  @IsNotEmpty()
  value: string;
} 