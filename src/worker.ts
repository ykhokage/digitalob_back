import { NestFactory } from '@nestjs/core';import { AppModule } from './app.module';import { WorkerService } from './worker/worker.service';
async function bootstrap(){process.env.PROCESS_ROLE='worker';const app=await NestFactory.createApplicationContext(AppModule);const worker=app.get(WorkerService);await worker.runScheduledChecks();console.log('Worker bootstrapped. Cron jobs are running.');}
bootstrap();
