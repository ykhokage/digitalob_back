import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({ controllers: [MetricsController], providers: [MetricsService, RolesGuard], exports: [MetricsService] })
export class MetricsModule {}
