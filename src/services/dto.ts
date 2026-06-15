import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import { Environment } from '@prisma/client';

export class ServiceDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsUrl({ require_tld: false, require_protocol: true }) url: string;
  @IsString() type: string;
  @IsEnum(Environment) environment: Environment;
  @Type(() => Number) @IsInt() @Min(10) checkIntervalSec: number;
  @Type(() => Number) @IsInt() @Min(100) timeoutMs: number;
  @IsArray() @Type(() => Number) @IsInt({ each: true }) expectedStatusCodes: number[];
  @Type(() => Number) @IsInt() @Min(1) responseThresholdMs: number;
  @Type(() => Number) @Min(0) @Max(100) errorRateThreshold: number;
  @Type(() => Number) @Min(0) @Max(100) cpuThreshold: number;
  @Type(() => Number) @Min(0) @Max(100) ramThreshold: number;
  @Type(() => Number) @Min(0) @Max(100) diskThreshold: number;
  @IsArray() @IsString({ each: true }) tags: string[];
  @IsOptional() @IsString() groupName?: string;
  @IsOptional() @IsString() ownerTeam?: string;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true }) url?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsEnum(Environment) environment?: Environment;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) checkIntervalSec?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) timeoutMs?: number;
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) expectedStatusCodes?: number[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) responseThresholdMs?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) errorRateThreshold?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) cpuThreshold?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) ramThreshold?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) diskThreshold?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() groupName?: string;
  @IsOptional() @IsString() ownerTeam?: string;
  @IsOptional() @IsBoolean() monitoringEnabled?: boolean;
  @IsOptional() @IsBoolean() isFavorite?: boolean;
}

export class MonitoringDto {
  @IsBoolean() enabled: boolean;
}

export class DependenciesDto {
  @IsArray() @IsString({ each: true }) targetIds: string[];
}
