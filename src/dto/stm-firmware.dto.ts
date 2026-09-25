import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterStmFirmwareDto {
  @IsIn(['inverter', 'charger'])
  product: 'inverter' | 'charger';

  @IsIn(['stable', 'beta'])
  channel: 'stable' | 'beta';

  // Dotted numeric version, e.g. "1.2.0".
  @IsString()
  @Matches(/^\d+(\.\d+){0,3}$/, { message: 'version must look like 1.2.0' })
  version: string;

  // Optional: defaults to {STM_FIRMWARE_BASE_URL}/{product}/{version}/app.bin
  // (https://giabao-inverter.com/firmware/stm/... like the ESP32 firmware).
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(500)
  binUrl?: string;

  // Defaults to app.json next to app.bin.
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(500)
  manifestUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SetStmFirmwareEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

export class StmUpdateDto {
  // Re-flash even when the device already runs the target image.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
