import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { DemoService } from './demo.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('demo')
export class DemoController {
  constructor(private service: DemoService) {}

  @Get()
  state(@CurrentUser() user: any) {
    return this.service.state(user);
  }

  @Post('run')
  run(@CurrentUser() user: any) {
    return this.service.run(user);
  }

  @Post('reset')
  reset(@CurrentUser() user: any) {
    return this.service.reset(user);
  }
}
