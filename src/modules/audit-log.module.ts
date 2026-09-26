import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../models/audit-log.schema';
import { AuditLogService } from '../services/audit-log.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
