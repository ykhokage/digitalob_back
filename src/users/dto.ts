import { IsEmail, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) website?: string | null;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() telegramChatId?: string;
  @IsOptional() @IsString() maxUserId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) webhookUrl?: string | null;
}

export class EmailChangeDto {
  @IsEmail() email: string;
}

export class ConfirmEmailChangeDto {
  @IsEmail() email: string;
  @IsString() code: string;
}

export class UpdateUserRoleDto {
  @IsIn(['ADMIN', 'OBSERVER']) role: 'ADMIN' | 'OBSERVER';
}
