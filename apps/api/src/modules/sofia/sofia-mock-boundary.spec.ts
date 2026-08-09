import { ForbiddenException } from '@nestjs/common';
import { SofiaService } from './sofia.service';

describe('Sofia mock service boundary', () => {
  function subject(environment: string) {
    const service = Object.create(SofiaService.prototype) as SofiaService;
    Object.assign(service, { configService: { get: () => environment } });
    return service;
  }

  it('rejects inbound and outbound mock persistence before any dependency call outside tests', async () => {
    const service = subject('production');

    await expect(service.registerMockInbound({ phone: '573001112222', body: 'test' }, 'actor'))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.registerMockOutbound('conversation', 'test', undefined, 'actor'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
