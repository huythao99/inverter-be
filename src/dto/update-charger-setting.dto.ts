import { IsNumber, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  CHARGER_VBAT_MIN,
  CHARGER_VBAT_MAX,
  CHARGER_IBAT_MIN,
  CHARGER_IBAT_MAX,
} from '../utils/charger-value.util';

/**
 * Human-friendly setting update for app/web: VBAT (V) + IBAT (A).
 * The backend encodes these into the 8-digit "HHHHLLLL" value.
 */
export class UpdateChargerSettingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(CHARGER_VBAT_MIN)
  @Max(CHARGER_VBAT_MAX)
  vbat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(CHARGER_IBAT_MIN)
  @Max(CHARGER_IBAT_MAX)
  ibat: number;
}
