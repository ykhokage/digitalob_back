import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IncidentStatus, Severity } from '@prisma/client';

export class IncidentDto {
  @IsString() serviceId: string;
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(Severity) severity: Severity;
  @IsOptional() @IsEnum(IncidentStatus) status?: IncidentStatus;
  @IsOptional() @IsString() rootCause?: string;
  @IsOptional() @IsString() assignedToId?: string;
}

export class UpdateIncidentDto {
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @IsEnum(IncidentStatus) status?: IncidentStatus;
  @IsOptional() @IsString() rootCause?: string;
  @IsOptional() @IsString() assignedToId?: string;
}

export class IncidentCommentDto {
  @IsString() body: string;
}

export class ResolveIncidentDto {
  @IsString() rootCause: string;
}
