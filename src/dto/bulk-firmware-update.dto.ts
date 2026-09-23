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
}
