import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTrackLogErrorDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  deviceId: string;

  @IsNotEmpty()
  @IsString()
  errorCode: string;

  @IsNotEmpty()
  @IsString()
  errorMessage: string;
}
