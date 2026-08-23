/**
 * SOFIA Address Remediation — Round 5 / A9. RULE 7 proof: a `DestinationSnapshot` can be persisted
 * onto EXISTING `OrderTicket` delivery* columns and `DeliveryPricingAudit.resultJson`, and
 * reconstructed after a fresh Prisma client connection (simulating a process restart — "security
 * must NOT depend on in-memory state") with everything needed to re-derive the RULE 2 usability
 * decision, with NO new Prisma migration.
 *
 * Runs against a REAL, isolated Postgres database (never `inventory_fastfood_system` /
 * `inventory_fastfood_system_test` — see `DATABASE_URL` in the test run environment).
 */

import { PrismaClient } from '@prisma/client';
import { applyDestinationEdit, isCoordinateUsableForPricing } from './destination-revision';
import {
  fromDeliveryQuoteAuditEnvelope,
  fromOrderTicketDeliveryColumns,
  toDeliveryQuoteAuditEnvelope,
  toOrderTicketDeliveryColumns,
} from './destination-state.persistence';

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('A9 destination-state — real Postgres round-trip (RULE 7)', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;
  let userId: string;
  let cashSessionId: string;
  const createdOrderTicketIds: string[] = [];
  const createdAuditIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/_test/.test(url) || /inventory_fastfood_system(_test)?$/.test(url.replace(/\?.*$/, ''))) {
      // Extra guardrail on top of the environment contract: refuse to run against anything that
      // isn't obviously an isolated test database, and never against the two named production/
      // shared-test databases this round must never touch.
      if (!/a9_round5_test/.test(url)) {
        throw new Error(`Refusing to run destination-state integration test against non-isolated DATABASE_URL: ${url}`);
      }
    }
    prisma = new PrismaClient();
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `a9-destination-state-${Date.now()}@invalid.local`,
        passwordHash: 'not-a-real-hash',
        fullName: 'A9 Destination State Test User',
      },
    });
    userId = user.id;

    const cashSession = await prisma.cashSession.create({
      data: { status: 'OPEN', openedById: userId, openingAmount: 0 },
    });
    cashSessionId = cashSession.id;
  });

  afterAll(async () => {
    await prisma.deliveryPricingAudit.deleteMany({ where: { id: { in: createdAuditIds } } }).catch(() => undefined);
    await prisma.orderTicket.deleteMany({ where: { id: { in: createdOrderTicketIds } } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function createOrderTicket(number: string) {
    const ticket = await prisma.orderTicket.create({
      data: {
        number,
        type: 'DELIVERY',
        cashSessionId,
        createdById: userId,
      },
    });
    createdOrderTicketIds.push(ticket.id);
    return ticket.id;
  }

  it('persists a TRUSTED current-revision pair, reloads via a FRESH PrismaClient, and remains usable for pricing', async () => {
    const orderId = await createOrderTicket(`A9-RT-${Date.now()}-1`);

    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const columns = toOrderTicketDeliveryColumns(snapshot, NOW);
    await prisma.orderTicket.update({ where: { id: orderId }, data: columns });

    // Simulate "process restart": a brand new PrismaClient, no shared in-memory reference to
    // `snapshot`/`columns` above.
    const freshClient = new PrismaClient();
    await freshClient.$connect();
    try {
      const row = await freshClient.orderTicket.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          deliveryReference: true,
          deliveryAddressNormalized: true,
          deliveryLatitude: true,
          deliveryLongitude: true,
          deliveryLocationSource: true,
          deliveryLocationReceivedAt: true,
          deliveryGeocodingProvider: true,
        },
      });
      const reconstructed = fromOrderTicketDeliveryColumns(row);
      expect(reconstructed.latitude).toBeCloseTo(3.62, 6);
      expect(reconstructed.longitude).toBeCloseTo(-76.15, 6);
      expect(reconstructed.spatialFingerprint).toBe(snapshot.spatialFingerprint);
      expect(isCoordinateUsableForPricing(reconstructed)).toBe(true);
    } finally {
      await freshClient.$disconnect();
    }
  });

  it('CRITICAL finding regression proof: a non-spatial-only edit round-trips through Postgres WITHOUT losing trusted coordinates', async () => {
    const orderId = await createOrderTicket(`A9-RT-${Date.now()}-2`);

    // Turn 1: real order, trusted GPS ~42km away (matches A8/A6's scenario numbers).
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20, casa azul', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    await prisma.orderTicket.update({ where: { id: orderId }, data: toOrderTicketDeliveryColumns(rev1, NOW) });

    // Turn 2: customer edits ONLY the non-spatial reference-field portion ("casa azul" -> "portón
    // negro"). Reload the PERSISTED state first (not the in-memory `rev1`) to prove the classifier
    // works correctly even when driven purely from what is actually in the database.
    const persistedRow = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        deliveryReference: true,
        deliveryAddressNormalized: true,
        deliveryLatitude: true,
        deliveryLongitude: true,
        deliveryLocationSource: true,
        deliveryLocationReceivedAt: true,
        deliveryGeocodingProvider: true,
      },
    });
    const reloadedRev1 = fromOrderTicketDeliveryColumns(persistedRow);
    expect(isCoordinateUsableForPricing(reloadedRev1)).toBe(true);

    const { snapshot: rev1Again, classification, revisionBumped } = applyDestinationEdit(
      reloadedRev1,
      { rawReferenceText: 'Calle 5 #10-20, portón negro' },
      NOW,
    );
    expect(classification).toBe('NON_SPATIAL');
    expect(revisionBumped).toBe(false);

    const nextColumns = toOrderTicketDeliveryColumns(rev1Again, NOW);
    await prisma.orderTicket.update({ where: { id: orderId }, data: nextColumns });

    const finalRow = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        deliveryReference: true,
        deliveryAddressNormalized: true,
        deliveryLatitude: true,
        deliveryLongitude: true,
        deliveryLocationSource: true,
        deliveryLocationReceivedAt: true,
        deliveryGeocodingProvider: true,
      },
    });
    // THE FIX: the trusted, real, far-away coordinates are STILL there after a purely cosmetic
    // instructions edit — unlike today's `referenceChanged` check, which would have nulled them
    // out and let a bare textual zone-alias match reopen LOCAL_FREE for this destination.
    expect(finalRow.deliveryLatitude).not.toBeNull();
    expect(finalRow.deliveryLongitude).not.toBeNull();
    expect(Number(finalRow.deliveryLatitude)).toBeCloseTo(3.62, 6);
    expect(Number(finalRow.deliveryLongitude)).toBeCloseTo(-76.15, 6);
    expect(finalRow.deliveryReference).toBe('Calle 5 #10-20, portón negro');
  });

  it('SAFETY regression proof: a genuinely SPATIAL edit persists NULL coordinates, not a stale far/near mismatch', async () => {
    const orderId = await createOrderTicket(`A9-RT-${Date.now()}-3`);
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    await prisma.orderTicket.update({ where: { id: orderId }, data: toOrderTicketDeliveryColumns(rev1, NOW) });

    const { snapshot: rev2 } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12, otra ciudad' }, NOW);
    await prisma.orderTicket.update({ where: { id: orderId }, data: toOrderTicketDeliveryColumns(rev2, NOW) });

    const row = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: orderId },
      select: { deliveryLatitude: true, deliveryLongitude: true, deliveryLocationReceivedAt: true },
    });
    expect(row.deliveryLatitude).toBeNull();
    expect(row.deliveryLongitude).toBeNull();
    expect(row.deliveryLocationReceivedAt).toBeNull();
  });

  it('DeliveryPricingAudit.resultJson round-trips full revision/coordinateBoundRevision fidelity for QUOTE BINDING', async () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev2 } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12' }, NOW);

    const audit = await prisma.deliveryPricingAudit.create({
      data: {
        requestJson: { addressText: 'Carrera 8 #40-12' },
        resultJson: toDeliveryQuoteAuditEnvelope(rev2) as unknown as object,
        calculationVersion: 'a9-destination-state-v1',
      },
    });
    createdAuditIds.push(audit.id);

    const freshClient = new PrismaClient();
    await freshClient.$connect();
    try {
      const reloadedAudit = await freshClient.deliveryPricingAudit.findUniqueOrThrow({ where: { id: audit.id } });
      const reconstructed = fromDeliveryQuoteAuditEnvelope(reloadedAudit.resultJson);
      expect(reconstructed).not.toBeNull();
      expect(reconstructed?.revision).toBe(2);
      expect(reconstructed?.coordinateBoundRevision).toBe(1);
      expect(reconstructed?.coordinateTrust).toBe('STALE');
      expect(reconstructed?.spatialFingerprint).toBe(rev2.spatialFingerprint);
    } finally {
      await freshClient.$disconnect();
    }
  });
});
