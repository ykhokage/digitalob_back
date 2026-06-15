import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateReportDto {
  @IsOptional() @IsString() title?: string;
  @IsDateString() periodFrom: string;
  @IsDateString() periodTo: string;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) slaTarget?: number;
}
