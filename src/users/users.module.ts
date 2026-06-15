import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StorageModule } from '../storage/storage.module';
import { RolesGuard } from '../common/roles.guard';
import { AuditModule } from '../audit/audit.module';
@Module({imports:[StorageModule,AuditModule],controllers:[UsersController],providers:[UsersService,RolesGuard],exports:[UsersService]})
export class UsersModule {}
