import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({ controllers: [DiagnosticsController], providers: [DiagnosticsService, RolesGuard] })
export class DiagnosticsModule {}
