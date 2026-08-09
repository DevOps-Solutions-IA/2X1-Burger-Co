import { Module } from '@nestjs/common';
import { CustomerServiceCaseService } from './customer-service-case.service';
import { CUSTOMER_SERVICE_CASE_REPOSITORY } from './persistence/customer-service-case.repository';
import { PrismaCustomerServiceCaseRepository } from './persistence/prisma-customer-service-case.repository';

@Module({
  providers: [
    CustomerServiceCaseService,
    PrismaCustomerServiceCaseRepository,
    { provide: CUSTOMER_SERVICE_CASE_REPOSITORY, useExisting: PrismaCustomerServiceCaseRepository },
  ],
  exports: [CustomerServiceCaseService],
})
export class CustomerServiceModule {}
