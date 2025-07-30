import { IsString, IsNotEmpty } from 'class-validator';

export class CreateInverterSettingDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  value: string;
} 