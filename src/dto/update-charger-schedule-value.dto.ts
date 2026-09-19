import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateChargerScheduleValueDto {
  // "start=HH:MM&end=HH:MM&value=HHHHLLLL[#...]" — max 10 segments
  @IsString()
  @IsNotEmpty()
  schedule: string;
}
