import { IsInt, Max, Min } from 'class-validator';

// POST /api/cms/devices/:id/uart-debug
export class UartDebugDto {
  // 1..30 = stream raw STM32 UART lines for that many minutes, 0 = stop.
  @IsInt()
  @Min(0)
  @Max(30)
  minutes: number;
}
