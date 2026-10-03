import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { IngredientsService } from './ingredients.service';

/**
 * A67 (blind red team, round 5 pass 67) — FINDING (LOW, proactive hardening): `IngredientsService`
 * had no cost-visibility shaping at all — `findAll()`/`findOne()` returned raw `costPrice` with no
 * conditioning on the caller's permissions, unlike `products.service.ts` (A65), which explicitly
 * treats ingredient `costPrice` as sensitive enough to strip when nested inside a product's recipe
 * (`stripProductAndRecipeCost()`).
 *
 * NOT CURRENTLY EXPLOITABLE: `GET /ingredients` and `GET /ingredients/:id` are gated by
 * `@Roles('ingredients.read')`, and per `prisma/seed.ts` that permission is held ONLY by
 * `admin`/`inventory` — both of whom already hold `products.update` (the cost-visible tier) too.
 * So under the CURRENT seed, no real HTTP request can reach `IngredientsController` while lacking
 * cost visibility — there is no negative e2e case to exercise.
 *
 * WHY FIX IT ANYWAY: this is defense-in-depth consistency with the now-established
 * `products.service.ts` pattern — if `ingredients.read` is ever granted to a broader role in the
 * future (e.g. `waiter` or `cashier`, mirroring how `products.read` already is), cost would leak
 * automatically unless the shaping already exists at the service layer. Same fix shape as A65/A67:
 * `IngredientsService` now defines `canViewCost()` gated on the same `products.update` permission,
 * and `IngredientsController` threads `@CurrentUser('permissions')` through to it.
 *
 * TEST STRATEGY: because the negative case is unreachable via real HTTP auth under the current
 * seed (no seeded user holds `ingredients.read` without also holding `products.update`), the
 * negative case is tested directly against `IngredientsService` (resolved from the real Nest DI
 * container via `app.get(IngredientsService)` — same PrismaService/AuditService wiring as
 * production, just bypassing the HTTP/RBAC layer to simulate a hypothetical non-cost-visible
 * caller). The positive/contrast case (admin, real HTTP) is tested end-to-end to prove the fix
 * does not regress the only reachable flow.
 */
describe('A67 — IngredientsService cost-visibility shaping (proactive hardening, defense in depth)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ingredientsService: IngredientsService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A67 ingredients cost-visibility tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    ingredientsService = app.get(IngredientsService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function login(email: string, password: string, xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email, password });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  it('FIXED (service-level, simulated non-cost-visible caller): findAll([]) and findOne(id, []) strip costPrice', async () => {
    const seed = await seedTestData(prisma);

    const all = await ingredientsService.findAll([]);
    expect(all.length).toBeGreaterThan(0);
    for (const ingredient of all) {
      expect(ingredient).not.toHaveProperty('costPrice');
    }
    // Non-cost fields must still be present — this is field-level shaping, not a broken route.
    const bun = all.find((ingredient) => ingredient.code === 'PAN-HAMB');
    expect(bun).toBeDefined();
    expect(bun!.name).toBe('Pan de hamburguesa');
    expect(bun!.currentStock).toBeDefined();

    const one = await ingredientsService.findOne(seed.bun.id, []);
    expect(one).not.toHaveProperty('costPrice');
    expect(one.name).toBe('Pan de hamburguesa');
  });

  it('FIXED (service-level): a caller lacking products.update (e.g. only holding an unrelated permission) also gets costPrice stripped', async () => {
    const seed = await seedTestData(prisma);

    const one = await ingredientsService.findOne(seed.bun.id, ['ingredients.read']);
    expect(one).not.toHaveProperty('costPrice');
  });

  it('CONTRAST (service-level): a caller holding products.update still receives real costPrice', async () => {
    const seed = await seedTestData(prisma);

    const one = await ingredientsService.findOne(seed.bun.id, ['products.update']);
    expect(one).toHaveProperty('costPrice');
    // TS's control-flow return-type inference collapses IngredientsService.findOne()'s two return
    // branches down to the narrower (cost-stripped) type via subtype reduction, even though this
    // branch (canViewCost === true) returns the full record at runtime — cast through `unknown` to
    // assert on the real runtime shape.
    expect(Number((one as unknown as { costPrice: unknown }).costPrice)).toBe(1000);

    const all = await ingredientsService.findAll(['products.update']);
    const bun = all.find((ingredient) => ingredient.code === 'PAN-HAMB');
    expect(bun).toHaveProperty('costPrice');
    expect(Number((bun as unknown as { costPrice: unknown }).costPrice)).toBe(1000);
  });

  it('CONTRAST (real HTTP, the only reachable flow under the current seed): admin still receives real costPrice on GET /ingredients and GET /ingredients/:id — the fix does not break the privileged flow', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.67.13');

    const listRes = await request(app.getHttpServer())
      .get('/ingredients')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const bun = listRes.body.find((ingredient: { code: string }) => ingredient.code === 'PAN-HAMB');
    expect(bun).toBeDefined();
    expect(Number(bun.costPrice)).toBe(1000);

    const oneRes = await request(app.getHttpServer())
      .get(`/ingredients/${seed.bun.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(oneRes.status).toBe(200);
    expect(Number(oneRes.body.costPrice)).toBe(1000);
  });

  it('CONTRAST: PATCH /ingredients/:id (update) audit trail still retains costPrice in oldValues — cost-visibility shaping never weakens the audit trail', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.67.14');

    const updateRes = await request(app.getHttpServer())
      .patch(`/ingredients/${seed.bun.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ costPrice: 1200 });
    expect(updateRes.status).toBe(200);

    const auditRow = await prisma.auditLog.findFirst({
      where: { module: 'ingredients', entity: 'ingredient', action: 'UPDATE', entityId: seed.bun.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
    const oldValues = auditRow!.oldValues as { costPrice?: unknown } | null;
    expect(oldValues).not.toBeNull();
    expect(oldValues).toHaveProperty('costPrice');
  });
});
