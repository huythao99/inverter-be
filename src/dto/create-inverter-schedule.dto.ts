import { IsString, IsNotEmpty } from 'class-validator';

export class CreateInverterScheduleDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  schedule: string;
}