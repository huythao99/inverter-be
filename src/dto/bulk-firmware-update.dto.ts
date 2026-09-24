import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Force a firmware (OTA) update on many inverter devices at once.
 * Either pass the selected device `_id`s, or `all: true` (optionally with the
 * same `search` the device list is filtered by) to target every match.
 */
export class BulkFirmwareUpdateDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsMongoId({ each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * By default devices whose reported firmware is already the newest are
   * skipped. Set true to re-flash them anyway.
   */
  @IsOptional()
  @IsBoolean()
  includeUpToDate?: boolean;

  /**
   * Beta-firmware devices (managed in the CMS beta list) are skipped by
   * default so a stable rollout doesn't touch them. Set true to include them
   * (they download the beta build, not the stable one).
   */
  @IsOptional()
  @IsBoolean()
  includeBeta?: boolean;
}
