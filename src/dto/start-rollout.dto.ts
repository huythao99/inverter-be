import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** Start a staged (canary) rollout of an uploaded inverter ESP32 build. */
export class StartRolloutDto {
  @IsMongoId()
  firmwareId: string;

  /** Percent of devices per stage, e.g. [5, 25, 50, 100]. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100, { each: true })
  stages?: number[];

  @IsOptional()
  @IsBoolean()
  autoPush?: boolean;

  @IsOptional()
  @IsBoolean()
  autoAdvance?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(336)
  stageHours?: number;

  /** 0.01..1 */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  maxFailRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  minSamples?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  observeMinutes?: number;
}
