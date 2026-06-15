import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { GenerateReportDto } from './dto';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get()
  list(@Query() q: any, @CurrentUser() user: any) {
    return this.service.list(q, user);
  }

  @Get('comparison')
  comparison(@Query() q: any, @CurrentUser() user: any) {
    return this.service.comparison(q, user);
  }

  @Post('generate')
  @Roles('ADMIN')
  generate(@CurrentUser() user: any, @Body() dto: GenerateReportDto) {
    return this.service.generate(user, dto);
  }

  @Post(':id/export/:format')
  export(@CurrentUser() user: any, @Param('id') id: string, @Param('format') format: string) {
    return this.service.export(id, user, format);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(id, user);
  }
}
