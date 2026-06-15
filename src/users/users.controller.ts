import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { Roles } from '../common/decorators';
import { RolesGuard } from '../common/roles.guard';
import { ConfirmEmailChangeDto, EmailChangeDto, UpdateProfileDto, UpdateUserRoleDto } from './dto';
import { UsersService } from './users.service';
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController { constructor(private service:UsersService){}
@Roles('ADMIN') @Get() findAll(@Query() q:any){return this.service.findAll(q)}
@Get('me/profile') profile(@CurrentUser() user:any){return this.service.findOne(user.sub)}
@Patch('me/profile') updateMe(@CurrentUser() user:any,@Body() dto:UpdateProfileDto){return this.service.update(user.sub,dto)}
@Post('me/avatar') @UseInterceptors(FileInterceptor('avatar',{limits:{fileSize:5*1024*1024}})) uploadAvatar(@CurrentUser() user:any,@UploadedFile() file:any){return this.service.uploadAvatar(user.sub,file)}
@Post('me/email-change') requestEmailChange(@CurrentUser() user:any,@Body() dto:EmailChangeDto){return this.service.requestEmailChange(user.sub,dto.email)}
@Post('me/email-change/confirm') confirmEmailChange(@CurrentUser() user:any,@Body() dto:ConfirmEmailChangeDto){return this.service.confirmEmailChange(user.sub,dto.email,dto.code)}
@Get('me/login-logs') logs(@CurrentUser() user:any){return this.service.loginLogs(user.sub)}
@Roles('ADMIN') @Get(':id') findOne(@Param('id') id:string){return this.service.findOne(id)}
@Roles('ADMIN') @Patch(':id/role') updateRole(@CurrentUser() user:any,@Param('id') id:string,@Body() dto:UpdateUserRoleDto){return this.service.updateRole(user.sub,id,dto.role)}
@Roles('ADMIN') @Patch(':id') update(@CurrentUser() user:any,@Param('id') id:string,@Body() dto:UpdateProfileDto){return this.service.update(id,dto,user.sub)}
}
