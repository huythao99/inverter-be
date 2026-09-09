import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateInverterDeviceDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  deviceName: string;

  @IsOptional()
  @IsString()
  description?: string;
}
