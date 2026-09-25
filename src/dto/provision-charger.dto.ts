import { IsOptional, IsString, Length, Matches } from 'class-validator';

// Body of POST /api/charger-device/provision (sent by the charger firmware).
export class ProvisionChargerDto {
  // AP SSID of the charger, e.g. "ChargerControl1369".
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/)
  deviceId: string;

  // One-time code from POST /api/user/chargers/claim.
  @IsString()
  @Length(16, 64)
  claim: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  firmwareVersion?: string;
}
