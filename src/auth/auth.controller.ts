import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ConfirmEmailDto, EmailDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, TwoFactorDto } from './dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
@Controller('auth')
export class AuthController { constructor(private auth:AuthService){}
@Post('register') register(@Body() dto:RegisterDto){return this.auth.register(dto)}
@Post('login') login(@Body() dto:LoginDto,@Req() req:any){return this.auth.login(dto,{ip:req.ip,ua:req.headers['user-agent']})}
@Post('refresh') refresh(@Body() dto:RefreshDto){return this.auth.refresh(dto.refreshToken)}
@Post('logout') logout(@Body() dto:RefreshDto){return this.auth.logout(dto.refreshToken)}
@Post('confirm-email') confirm(@Body() dto:ConfirmEmailDto){return this.auth.confirmEmail(dto.email,dto.code)}
@Post('forgot-password') forgot(@Body() dto:EmailDto){return this.auth.forgotPassword(dto.email)}
@Post('reset-password') reset(@Body() dto:ResetPasswordDto){return this.auth.resetPassword(dto.token,dto.password)}
@UseGuards(JwtAuthGuard) @Post('change-password') changePassword(@CurrentUser() user:any,@Body() dto:ChangePasswordDto){return this.auth.changePassword(user.sub,dto.oldPassword,dto.newPassword)}
@UseGuards(JwtAuthGuard) @Post('2fa/setup') setupTwoFactor(@CurrentUser() user:any){return this.auth.setupTwoFactor(user.sub)}
@UseGuards(JwtAuthGuard) @Post('2fa/enable') enableTwoFactor(@CurrentUser() user:any,@Body() dto:TwoFactorDto){return this.auth.enableTwoFactor(user.sub,dto.code)}
@UseGuards(JwtAuthGuard) @Post('2fa/disable') disableTwoFactor(@CurrentUser() user:any,@Body() dto:TwoFactorDto){return this.auth.disableTwoFactor(user.sub,dto.code)}
@UseGuards(JwtAuthGuard) @Get('me') me(@CurrentUser() user:any){return this.auth.me(user.sub)}
}
