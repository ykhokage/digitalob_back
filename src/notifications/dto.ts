import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { NotificationChannel, NotificationType } from '@prisma/client';

export class NotificationRuleDto {
  @IsString() name: string;
  @IsEnum(NotificationType) type: NotificationType;
  @IsEnum(NotificationChannel) channel: NotificationChannel;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) quietHoursStart?: string;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) quietHoursEnd?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) escalationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) dedupeWindowSec?: number;
  @IsOptional() config?: Record<string, unknown>;
}

export class UpdateNotificationRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(NotificationType) type?: NotificationType;
  @IsOptional() @IsEnum(NotificationChannel) channel?: NotificationChannel;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) quietHoursStart?: string;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) quietHoursEnd?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) escalationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) dedupeWindowSec?: number;
  @IsOptional() config?: Record<string, unknown>;
}
