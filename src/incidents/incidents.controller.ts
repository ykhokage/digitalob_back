import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { IncidentCommentDto, IncidentDto, ResolveIncidentDto, UpdateIncidentDto } from './dto';
import { IncidentsService } from './incidents.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private service: IncidentsService) {}

  @Get()
  list(@Query() q: any, @CurrentUser() user: any) {
    return this.service.list(q, user);
  }

  @Post('export/:format')
  export(@Query() q: any, @Param('format') format: string, @CurrentUser() user: any) {
    return this.service.export(q, format, user);
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: IncidentDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIncidentDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Post(':id/comments')
  comment(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: IncidentCommentDto) {
    return this.service.comment(id, user.sub, dto.body);
  }

  @Roles('ADMIN')
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: ResolveIncidentDto) {
    return this.service.resolve(id, user, dto.rootCause);
  }
}
