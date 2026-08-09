import { hash } from 'bcryptjs';
import { ProductBrand, ProductKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

function normalizeAccessName(value: string) {
  return value.trim().toLowerCase();
}

export const WAITER_ACCESS_NAME = 'Mesero Principal';
export const WAITER_ACCESS_CODE = 'M124578';
export const DELIVERY_ACCESS_NAME = 'Domiciliario Principal';
export const DELIVERY_ACCESS_CODE = 'D124578';

export async function resetDatabase(prisma: PrismaService) {
  const database = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const databaseName = database[0]?.current_database ?? '';
  if (!databaseName.endsWith('_test')) {
    throw new Error(`resetDatabase solo puede ejecutarse sobre una base de pruebas. Recibido: ${databaseName}`);
  }

  // Test-only reset: serialize all destructive cleanup through a PostgreSQL
  // advisory transaction lock. This prevents deadlocks when several suites reset
  // the shared _test database while app connections are still closing.
  const tables = [
    'notification_intents',
    'customer_service_case_events',
    'customer_service_cases',
    'delivery_workflow_events',
    'payment_transitions',
    'payment_links',
    'payment_webhook_events',
    'payment_intents',
    'order_checkouts',
    'sofia_command_results',
    'sofia_command_attempts',
    'sofia_command_approvals',
    'sofia_commands',
    'whatsapp_message_status_events',
    'whatsapp_media_envelopes',
    'whatsapp_handoff_events',
    'delivery_pricing_audits',
    'delivery_provider_usage',
    'external_api_cache',
    'audit_logs',
    'whatsapp_delivery_orders',
    'sofia_order_drafts',
    'sofia_auto_safe_decision_events',
    'sofia_commercial_rule_events',
    'sofia_conversation_memories',
    'sofia_customer_memories',
    'sofia_commercial_catalog_items',
    'sofia_prompt_versions',
    'whatsapp_outbound_messages',
    'whatsapp_inbound_events',
    'whatsapp_messages',
    'whatsapp_conversations',
    'whatsapp_provider_accounts',
    'supplier_notifications',
    'reports_snapshots',
    'expenses',
    'cash_movements',
    'sale_payments',
    'sale_items',
    'sale_conversions',
    'sales',
    'waiter_order_sync_receipts',
    'delivery_issues',
    'delivery_location_inbox',
    'operational_alerts',
    'order_ticket_items',
    'order_tickets',
    'cash_sessions',
    'delivery_customers',
    'waiter_table_group_assignments',
    'table_groups',
    'dining_tables',
    'payment_methods',
    'inventory_movements',
    'purchase_items',
    'purchases',
    'recipe_items',
    'recipes',
    'ingredients',
    'products',
    'suppliers',
    'units',
    'categories',
    'refresh_tokens',
    'role_permissions',
    'user_roles',
    'permissions',
    'roles',
    'settings',
    'users',
  ];

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(281020260620)`;
      await tx.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
    },
    {
      maxWait: 60_000,
      timeout: 60_000,
    },
  );
}

export async function seedTestData(prisma: PrismaService) {
  const permissionCodes = [
    'auth.login',
    'auth.refresh',
    'auth.logout',
    'auth.me',
    'users.read',
    'roles.read',
    'settings.read',
    'settings.update',
    'categories.read',
    'categories.create',
    'categories.update',
    'products.read',
    'products.create',
    'products.update',
    'ingredients.read',
    'ingredients.create',
    'ingredients.update',
    'suppliers.read',
    'suppliers.create',
    'suppliers.update',
    'recipes.read',
    'recipes.update',
    'inventory.read',
    'inventory.adjust',
    'purchases.read',
    'purchases.create',
    'sales.read',
    'sales.create',
    'tables.read',
    'tables.create',
    'tables.update',
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.checkout',
    'cash.read',
    'cash.open',
    'cash.close',
    'expenses.read',
    'expenses.create',
    'expenses.update',
    'reports.read',
    'reports.pdf',
    'delivery.read',
    'delivery.assign',
    'delivery.update',
  ];

  await prisma.permission.createMany({
    data: permissionCodes.map((code) => ({
      code,
      description: code,
    })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany();
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {
      permissions: {
        deleteMany: {},
        create: permissions.map((permission) => ({
          permissionId: permission.id,
        })),
      },
    },
    create: {
      name: 'admin',
      isSystem: true,
      permissions: {
        create: permissions.map((permission) => ({
          permissionId: permission.id,
        })),
      },
    },
  });

  const cashierRole = await prisma.role.upsert({
    where: { name: 'cashier' },
    update: {
      permissions: {
        deleteMany: {},
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'sales.read',
              'sales.create',
              'tables.read',
              'orders.read',
              'orders.create',
              'orders.update',
              'orders.checkout',
              'cash.read',
              'cash.open',
              'cash.close',
              'expenses.read',
              'expenses.create',
              'reports.read',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
    create: {
      name: 'cashier',
      isSystem: true,
      permissions: {
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'sales.read',
              'sales.create',
              'tables.read',
              'orders.read',
              'orders.create',
              'orders.update',
              'orders.checkout',
              'cash.read',
              'cash.open',
              'cash.close',
              'expenses.read',
              'expenses.create',
              'reports.read',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
  });

  const waiterRole = await prisma.role.upsert({
    where: { name: 'waiter' },
    update: {
      permissions: {
        deleteMany: {},
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'products.read',
              'tables.read',
              'orders.read',
              'orders.create',
              'orders.update',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
    create: {
      name: 'waiter',
      isSystem: true,
      permissions: {
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'products.read',
              'tables.read',
              'orders.read',
              'orders.create',
              'orders.update',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
  });

  const deliveryRole = await prisma.role.upsert({
    where: { name: 'delivery' },
    update: {
      permissions: {
        deleteMany: {},
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'orders.read',
              'delivery.read',
              'delivery.update',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
    create: {
      name: 'delivery',
      isSystem: true,
      permissions: {
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'orders.read',
              'delivery.read',
              'delivery.update',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
  });

  const adminPassword = 'Admin12345*';
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@2x1burgerco.local' },
    update: {
      fullName: 'Admin Test',
      passwordHash: await hash(adminPassword, 12),
      roles: {
        deleteMany: {},
        create: [{ roleId: adminRole.id }],
      },
    },
    create: {
      email: 'admin@2x1burgerco.local',
      fullName: 'Admin Test',
      passwordHash: await hash(adminPassword, 12),
      roles: {
        create: [{ roleId: adminRole.id }],
      },
    },
  });

  const cashierPassword = 'Cashier12345*';
  const cashierUser = await prisma.user.upsert({
    where: { email: 'cashier@2x1burgerco.local' },
    update: {
      fullName: 'Cashier Test',
      passwordHash: await hash(cashierPassword, 12),
      roles: {
        deleteMany: {},
        create: [{ roleId: cashierRole.id }],
      },
    },
    create: {
      email: 'cashier@2x1burgerco.local',
      fullName: 'Cashier Test',
      passwordHash: await hash(cashierPassword, 12),
      roles: {
        create: [{ roleId: cashierRole.id }],
      },
    },
  });

  const waiterPassword = 'Waiter12345*';
  const waiterAccessName = WAITER_ACCESS_NAME;
  const waiterAccessCode = WAITER_ACCESS_CODE;
  const waiterUser = await prisma.user.upsert({
    where: { email: 'waiter@2x1burgerco.local' },
    update: {
      fullName: 'Waiter Test',
      accessName: normalizeAccessName(waiterAccessName),
      accessCodeHash: await hash(waiterAccessCode, 12),
      passwordHash: await hash(waiterPassword, 12),
      roles: {
        deleteMany: {},
        create: [{ roleId: waiterRole.id }],
      },
    },
    create: {
      email: 'waiter@2x1burgerco.local',
      fullName: 'Waiter Test',
      accessName: normalizeAccessName(waiterAccessName),
      accessCodeHash: await hash(waiterAccessCode, 12),
      passwordHash: await hash(waiterPassword, 12),
      roles: {
        create: [{ roleId: waiterRole.id }],
      },
    },
  });

  const inventoryRole = await prisma.role.upsert({
    where: { name: 'inventory' },
    update: {
      permissions: {
        deleteMany: {},
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'categories.read',
              'ingredients.read',
              'inventory.read',
              'purchases.read',
              'recipes.read',
              'suppliers.read',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
    create: {
      name: 'inventory',
      isSystem: true,
      permissions: {
        create: permissions
          .filter((permission) =>
            [
              'auth.login',
              'auth.refresh',
              'auth.logout',
              'auth.me',
              'categories.read',
              'ingredients.read',
              'inventory.read',
              'purchases.read',
              'recipes.read',
              'suppliers.read',
            ].includes(permission.code),
          )
          .map((permission) => ({
            permissionId: permission.id,
          })),
      },
    },
  });

  const deliveryPassword = 'Delivery12345*';
  const deliveryAccessName = DELIVERY_ACCESS_NAME;
  const deliveryAccessCode = DELIVERY_ACCESS_CODE;
  const deliveryUser = await prisma.user.upsert({
    where: { email: 'delivery@2x1burgerco.local' },
    update: {
      fullName: 'Delivery Test',
      accessName: normalizeAccessName(deliveryAccessName),
      accessCodeHash: await hash(deliveryAccessCode, 12),
      passwordHash: await hash(deliveryPassword, 12),
      roles: {
        deleteMany: {},
        create: [{ roleId: deliveryRole.id }],
      },
    },
    create: {
      email: 'delivery@2x1burgerco.local',
      fullName: 'Delivery Test',
      accessName: normalizeAccessName(deliveryAccessName),
      accessCodeHash: await hash(deliveryAccessCode, 12),
      passwordHash: await hash(deliveryPassword, 12),
      roles: {
        create: [{ roleId: deliveryRole.id }],
      },
    },
  });

  const inventoryPassword = 'Inventory12345*';
  const inventoryUser = await prisma.user.upsert({
    where: { email: 'inventory@2x1burgerco.local' },
    update: {
      fullName: 'Inventory Test',
      passwordHash: await hash(inventoryPassword, 12),
      roles: {
        deleteMany: {},
        create: [{ roleId: inventoryRole.id }],
      },
    },
    create: {
      email: 'inventory@2x1burgerco.local',
      fullName: 'Inventory Test',
      passwordHash: await hash(inventoryPassword, 12),
      roles: {
        create: [{ roleId: inventoryRole.id }],
      },
    },
  });

  const unitPiece = await prisma.unit.upsert({
    where: { code: 'unit' },
    update: {
      name: 'Unit',
      abbreviation: 'u',
    },
    create: {
      code: 'unit',
      name: 'Unit',
      abbreviation: 'u',
    },
  });

  const burgersCategory = await prisma.category.upsert({
    where: { slug: 'hamburguesas' },
    update: {
      name: 'Hamburguesas',
    },
    create: {
      name: 'Hamburguesas',
      slug: 'hamburguesas',
    },
  });

  const drinksCategory = await prisma.category.upsert({
    where: { slug: 'bebidas' },
    update: {
      name: 'Bebidas',
    },
    create: {
      name: 'Bebidas',
      slug: 'bebidas',
    },
  });

  const supplier = await prisma.supplier.upsert({
    where: { taxId: 'SUPPLIER-DEMO' },
    update: {
      name: 'Proveedor Demo',
      contactName: 'Laura Compras',
      phone: '573001112233',
    },
    create: {
      name: 'Proveedor Demo',
      taxId: 'SUPPLIER-DEMO',
      contactName: 'Laura Compras',
      phone: '573001112233',
    },
  });

  const paymentCash = await prisma.paymentMethod.upsert({
    where: { code: 'cash' },
    update: {
      name: 'Efectivo',
    },
    create: {
      code: 'cash',
      name: 'Efectivo',
    },
  });

  const paymentNequi = await prisma.paymentMethod.upsert({
    where: { code: 'nequi' },
    update: {
      name: 'Nequi',
    },
    create: {
      code: 'nequi',
      name: 'Nequi',
    },
  });

  const tableOne = await prisma.diningTable.upsert({
    where: { label: 'Mesa 1' },
    update: {
      area: 'Salón principal',
      capacity: 4,
    },
    create: {
      label: 'Mesa 1',
      area: 'Salón principal',
      capacity: 4,
    },
  });

  await prisma.diningTable.upsert({
    where: { label: 'Mesa 2' },
    update: {
      area: 'Salón principal',
      capacity: 4,
    },
    create: {
      label: 'Mesa 2',
      area: 'Salón principal',
      capacity: 4,
    },
  });

  await prisma.diningTable.upsert({
    where: { label: 'Mesa 3' },
    update: {
      area: 'Terraza',
      capacity: 2,
    },
    create: {
      label: 'Mesa 3',
      area: 'Terraza',
      capacity: 2,
    },
  });

  await prisma.diningTable.upsert({
    where: { label: 'Mesa 4' },
    update: {
      area: 'Terraza',
      capacity: 2,
    },
    create: {
      label: 'Mesa 4',
      area: 'Terraza',
      capacity: 2,
    },
  });

  const bun = await prisma.ingredient.upsert({
    where: { code: 'PAN-HAMB' },
    update: {
      name: 'Pan de hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 1000,
    },
    create: {
      code: 'PAN-HAMB',
      name: 'Pan de hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 1000,
    },
  });

  const patty = await prisma.ingredient.upsert({
    where: { code: 'CARNE-100' },
    update: {
      name: 'Carne de hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 2500,
    },
    create: {
      code: 'CARNE-100',
      name: 'Carne de hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 2500,
    },
  });

  const cheese = await prisma.ingredient.upsert({
    where: { code: 'QUESO-LONJA' },
    update: {
      name: 'Queso lonja',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 700,
    },
    create: {
      code: 'QUESO-LONJA',
      name: 'Queso lonja',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 700,
    },
  });

  const bag = await prisma.ingredient.upsert({
    where: { code: 'CAJA-HAMB' },
    update: {
      name: 'Empaque hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 400,
    },
    create: {
      code: 'CAJA-HAMB',
      name: 'Empaque hamburguesa',
      unitId: unitPiece.id,
      currentStock: 20,
      stockMin: 2,
      costPrice: 400,
    },
  });

  const burger = await prisma.product.upsert({
    where: { code: 'HAMB-2X1' },
    update: {
      name: 'Hamburguesa 2x1',
      categoryId: burgersCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.PREPARED,
      salePrice: 20000,
      trackStock: false,
      currentStock: 0,
      stockMin: 0,
      recipes: {
        deleteMany: {},
        create: {
          name: 'Receta Hamburguesa 2x1',
          yieldQuantity: 1,
          items: {
            create: [
              { ingredientId: bun.id, quantity: 2, wastePercent: 0 },
              { ingredientId: patty.id, quantity: 2, wastePercent: 0 },
              { ingredientId: cheese.id, quantity: 2, wastePercent: 0 },
              { ingredientId: bag.id, quantity: 1, wastePercent: 0 },
            ],
          },
        },
      },
    },
    create: {
      code: 'HAMB-2X1',
      name: 'Hamburguesa 2x1',
      categoryId: burgersCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.PREPARED,
      salePrice: 20000,
      trackStock: false,
      currentStock: 0,
      stockMin: 0,
      recipes: {
        create: {
          name: 'Receta Hamburguesa 2x1',
          yieldQuantity: 1,
          items: {
            create: [
              { ingredientId: bun.id, quantity: 2, wastePercent: 0 },
              { ingredientId: patty.id, quantity: 2, wastePercent: 0 },
              { ingredientId: cheese.id, quantity: 2, wastePercent: 0 },
              { ingredientId: bag.id, quantity: 1, wastePercent: 0 },
            ],
          },
        },
      },
    },
  });

  const soda = await prisma.product.upsert({
    where: { code: 'CC-ORG-400' },
    update: {
      name: 'Coca-Cola Original 400 ml',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.COCA_COLA,
      salePrice: 4500,
      costPrice: 2500,
      trackStock: true,
      currentStock: 10,
      stockMin: 2,
    },
    create: {
      code: 'CC-ORG-400',
      name: 'Coca-Cola Original 400 ml',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.COCA_COLA,
      salePrice: 4500,
      costPrice: 2500,
      trackStock: true,
      currentStock: 10,
      stockMin: 2,
    },
  });

  await prisma.product.upsert({
    where: { code: 'CC-ORG-1500' },
    update: {
      name: 'Coca-Cola Original 1.5 L',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.COCA_COLA,
      salePrice: 9000,
      costPrice: 5000,
      trackStock: true,
      currentStock: 10,
      stockMin: 2,
    },
    create: {
      code: 'CC-ORG-1500',
      name: 'Coca-Cola Original 1.5 L',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.COCA_COLA,
      salePrice: 9000,
      costPrice: 5000,
      trackStock: true,
      currentStock: 10,
      stockMin: 2,
    },
  });

  await prisma.product.upsert({
    where: { code: 'POKER-330' },
    update: {
      name: 'Cerveza Poker 330 ml',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.OTHER,
      salePrice: 4000,
      costPrice: 2500,
      trackStock: true,
      currentStock: 12,
      stockMin: 2,
    },
    create: {
      code: 'POKER-330',
      name: 'Cerveza Poker 330 ml',
      categoryId: drinksCategory.id,
      unitId: unitPiece.id,
      kind: ProductKind.DIRECT_STOCK,
      brand: ProductBrand.OTHER,
      salePrice: 4000,
      costPrice: 2500,
      trackStock: true,
      currentStock: 12,
      stockMin: 2,
    },
  });

  return {
    adminUser,
    adminPassword,
    cashierUser,
    cashierPassword,
    cashierRole,
    waiterUser,
    waiterPassword,
    waiterAccessName,
    waiterAccessCode,
    waiterRole,
    deliveryUser,
    deliveryPassword,
    deliveryAccessName,
    deliveryAccessCode,
    deliveryRole,
    inventoryUser,
    inventoryPassword,
    inventoryRole,
    supplier,
    paymentCash,
    paymentNequi,
    tableOne,
    burger,
    soda,
    bun,
    patty,
    cheese,
    bag,
  };
}
