import 'reflect-metadata';
import { DeliveryWorkflowStatus } from '@prisma/client';
import { validate } from 'class-validator';
import {
  ApplyDeliveryLocationDto,
  TransitionDeliveryWorkflowDto,
} from './delivery-operation.dto';

describe('delivery operation DTOs', () => {
  it('accepts a versioned, idempotent workflow command', async () => {
    const dto = Object.assign(new TransitionDeliveryWorkflowDto(), {
      expectedVersion: 4,
      idempotencyKey: 'delivery:order-1:assigned:4',
      workflowStatus: DeliveryWorkflowStatus.ASSIGNED,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects missing version and weak idempotency keys', async () => {
    const dto = Object.assign(new TransitionDeliveryWorkflowDto(), {
      idempotencyKey: 'short',
      workflowStatus: DeliveryWorkflowStatus.ASSIGNED,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['expectedVersion', 'idempotencyKey']),
    );
  });

  it('validates version and idempotency on location commands too', async () => {
    const valid = Object.assign(new ApplyDeliveryLocationDto(), {
      expectedVersion: 2,
      idempotencyKey: 'delivery:location:message-1',
      latitude: 3.4516,
      longitude: -76.532,
      senderIdentityCandidates: ['573001112233'],
    });
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = Object.assign(new ApplyDeliveryLocationDto(), {
      expectedVersion: -1,
      idempotencyKey: 'invalid key',
      latitude: 120,
      longitude: -200,
      senderIdentityCandidates: [],
    });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'expectedVersion',
        'idempotencyKey',
        'latitude',
        'longitude',
        'senderIdentityCandidates',
      ]),
    );
  });
});
