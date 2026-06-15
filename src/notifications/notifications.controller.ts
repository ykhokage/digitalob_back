import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { NotificationRuleDto, UpdateNotificationRuleDto } from './dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get('rules')
  rules(@CurrentUser() user: any) {
    return this.service.rules(user);
  }

  @Get('setup')
  setup(@CurrentUser() user: any) {
    return this.service.setup(user);
  }

  @Post('telegram/link')
  createTelegramLink(@CurrentUser() user: any) {
    return this.service.createTelegramLink(user);
  }

  @Get('web-push/public-key')
  webPushPublicKey() {
    return this.service.webPushPublicKey();
  }

  @Post('web-push/subscribe')
  subscribeWebPush(@CurrentUser() user: any, @Body() dto: any) {
    return this.service.subscribeWebPush(user, dto);
  }

  @Post('web-push/unsubscribe')
  unsubscribeWebPush(@CurrentUser() user: any, @Body() dto: any) {
    return this.service.unsubscribeWebPush(user, dto.endpoint);
  }

  @Post('rules')
  create(@CurrentUser() user: any, @Body() dto: NotificationRuleDto) {
    return this.service.createRule(user, dto);
  }

  @Patch('rules/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateNotificationRuleDto) {
    return this.service.updateRule(user, id, dto);
  }

  @Delete('rules/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.removeRule(user, id);
  }

  @Get('log')
  log(@CurrentUser() user: any, @Query() q: any) {
    return this.service.log(user, q);
  }

  @Post('log/:id/ack')
  ack(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.ack(user, id);
  }

  @Post('test')
  test(@CurrentUser() user: any, @Body() dto: any) {
    return this.service.test(user, dto.channel, dto.recipient);
  }

  @Post('rules/:id/send-now')
  sendNow(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.sendReportNow(user, id);
  }
}
