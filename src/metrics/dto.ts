import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class MetricDto {
  @IsString() serviceId: string;
  @Type(() => Number) @Min(0) @Max(100) availability: number;
  @Type(() => Number) @IsInt() @Min(0) responseTimeMs: number;
  @Type(() => Number) @Min(0) @Max(100) successRate: number;
  @Type(() => Number) @Min(0) @Max(100) errorRate: number;
  @IsOptional() @Type(() => Number) @IsInt() httpStatus?: number;
  @Type(() => Number) @IsInt() @Min(0) uptimeSec: number;
  @Type(() => Number) @IsInt() @Min(0) downtimeSec: number;
  @Type(() => Number) @IsInt() @Min(0) failureCount: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) cpuUsage?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) ramUsage?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) diskUsage?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) requestsPerMinute?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) avgResponseTimeMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) peakResponseTimeMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) appErrorCount?: number;
}
