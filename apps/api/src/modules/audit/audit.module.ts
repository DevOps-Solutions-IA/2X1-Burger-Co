import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context.interceptor';
import { AuditContextService } from './audit-context.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditContextService,
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
  exports: [AuditContextService, AuditService],
})
export class AuditModule {}
