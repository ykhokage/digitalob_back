import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { DependenciesDto, MonitoringDto, ServiceDto, UpdateServiceDto } from './dto';
import { ServicesService } from './services.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesController {
  constructor(private service: ServicesService) {}

  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Get('architecture')
  architecture(@CurrentUser() user: any) {
    return this.service.architecture(user);
  }

  @Get('sla')
  sla(@Query() q: any, @CurrentUser() user: any) {
    return this.service.sla(q, user);
  }

  @Get(':id/insights')
  insights(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.insights(id, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: ServiceDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Post(':id/dependencies')
  deps(@Param('id') id: string, @Body() dto: DependenciesDto, @CurrentUser() user: any) {
    return this.service.setDependencies(id, dto.targetIds || [], user);
  }

  @Post(':id/monitoring')
  mon(@Param('id') id: string, @Body() dto: MonitoringDto, @CurrentUser() user: any) {
    return this.service.toggleMonitoring(id, dto.enabled, user);
  }

  @Post(':id/check')
  checkNow(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.checkNow(id, user);
  }

}
