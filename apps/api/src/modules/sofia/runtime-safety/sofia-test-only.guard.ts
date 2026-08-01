import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SofiaTestOnlyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(_context: ExecutionContext) {
    if (this.configService.get<string>('NODE_ENV') !== 'test') {
      throw new NotFoundException({ code: 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE' });
    }
    return true;
  }
}
