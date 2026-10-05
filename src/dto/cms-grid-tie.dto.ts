import { IsBoolean } from 'class-validator';

// PUT /api/cms/devices/:id/grid-tie
export class CmsGridTieDto {
  // true = tắt hoà lưới (99.00 V / 1 W), false = hoà lưới bình thường.
  @IsBoolean()
  off: boolean;
}
