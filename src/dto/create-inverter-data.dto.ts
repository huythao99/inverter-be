import { IsString, IsNumber, IsNotEmpty } from 'class-validator';

export class CreateInverterDataDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsNumber()
  totalACapacity: number;

  @IsNumber()
  totalA2Capacity: number;
} 