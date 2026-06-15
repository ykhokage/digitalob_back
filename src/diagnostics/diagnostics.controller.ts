import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { DiagnosticsService } from './diagnostics.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private service: DiagnosticsService) {}

  @Get()
  summary() {
    return this.service.summary();
  }
}
