import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { MetricDto } from './dto';
import { MetricsService } from './metrics.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private service: MetricsService) {}

  @Get()
  list(@Query() q: any, @CurrentUser() user: any) {
    return this.service.list(q, user);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: MetricDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get('checks')
  checks(@Query() q: any, @CurrentUser() user: any) {
    return this.service.checks(q, user);
  }
}
