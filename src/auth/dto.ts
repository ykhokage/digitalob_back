import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
export class RegisterDto { @IsEmail() email:string; @MinLength(8) password:string; @IsString() name:string; }
export class LoginDto { @IsEmail() email:string; @IsString() password:string; @IsOptional() @IsString() twoFactorCode?:string; }
export class RefreshDto { @IsString() refreshToken:string; }
export class EmailDto { @IsEmail() email:string; }
export class ConfirmEmailDto { @IsEmail() email:string; @IsString() code:string; }
export class ResetPasswordDto { @IsString() token:string; @MinLength(8) password:string; }
export class ChangePasswordDto { @IsString() oldPassword:string; @MinLength(8) newPassword:string; }
export class TwoFactorDto { @IsString() code:string; }
