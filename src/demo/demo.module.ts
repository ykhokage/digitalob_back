import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RolesGuard } from '../common/roles.guard';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({ imports: [AuditModule], controllers: [DemoController], providers: [DemoService, RolesGuard] })
export class DemoModule {}
