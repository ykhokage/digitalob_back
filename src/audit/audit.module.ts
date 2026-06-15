import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}
