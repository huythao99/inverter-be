import { IsString, Matches } from 'class-validator';

export class UpdateChargerSettingValueDto {
  // 8-digit "HHHHLLLL" string (VBAT*10 followed by IBAT*10)
  @IsString()
  @Matches(/^\d{8}$/, {
    message: 'value must be an 8-digit string (HHHHLLLL)',
  })
  value: string;
}
