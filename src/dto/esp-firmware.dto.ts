import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// multipart/form-data fields of POST /api/cms/esp-firmwares/upload (file "bin").
export class UploadEspFirmwareDto {
  // Which device the build is for.
  @IsIn(['inverter', 'charger', 'hybrid'])
  product: 'inverter' | 'charger' | 'hybrid';

  // Must equal currentFirmwareVersion of the build, e.g. "1.0.15".
  @IsString()
  @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, {
    message: 'version must look like 1.0.15',
  })
  version: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // Shown to users (app / web).
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  releaseNotes?: string;

  // Make it active on this channel right after the upload.
  @IsOptional()
  @IsIn(['stable', 'beta'])
  activate?: 'stable' | 'beta';
}

export class ActivateEspFirmwareDto {
  @IsIn(['stable', 'beta'])
  channel: 'stable' | 'beta';
}

// PATCH /api/cms/esp-firmwares/:id
export class UpdateEspFirmwareNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  releaseNotes?: string;
}
