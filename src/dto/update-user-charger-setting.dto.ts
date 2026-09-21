import { IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  CHARGER_VBAT_MIN,
  CHARGER_VBAT_MAX,
  CHARGER_IBAT_MIN,
  CHARGER_IBAT_MAX,
} from '../utils/charger-value.util';

/**
 * Update a charger setting from the end-user app/web. Either send the raw
 * 8-digit `value` ("HHHHLLLL"), or the human-friendly `vbat`/`ibat` pair.
 */
export class UpdateUserChargerSettingDto {
  @IsOptional()
  @Matches(/^\d{8}$/, {
    message: 'value must be an 8-digit string (HHHHLLLL)',
  })
  value?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(CHARGER_VBAT_MIN)
  @Max(CHARGER_VBAT_MAX)
  vbat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(CHARGER_IBAT_MIN)
  @Max(CHARGER_IBAT_MAX)
  ibat?: number;
}
