import { IsIn } from 'class-validator';

// PUT /api/cms/devices/:id/stm-protocol
export class StmProtocolDto {
  // auto = the ESP32 detects it at boot, new / legacy = forced.
  @IsIn(['auto', 'new', 'legacy'])
  mode: 'auto' | 'new' | 'legacy';
}
