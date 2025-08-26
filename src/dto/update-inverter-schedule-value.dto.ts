import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateInverterScheduleValueDto {
  @IsString()
  @IsNotEmpty()
  schedule: string;
}
