import { ProductBrand, ProductKind, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { beverageCatalog } from './beverage-catalog';

const prisma = new PrismaClient();
const pruneSeedCatalog = process.env.SEED_PRUNE_CATALOG === 'true';
const SEED_ADVISORY_LOCK_ID = 9102026040901n;

function getDatabaseName() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return null;
  }

  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

function isTestDatabase(databaseName: string | null) {
  return Boolean(databaseName && databaseName.endsWith('_test'));
}

function normalizeAccessName(value: string) {
  return value.trim().toLowerCase();
}

const permissionsByModule = {
  auth: ['auth.login', 'auth.refresh', 'auth.logout', 'auth.me'],
  users: ['users.read', 'users.create', 'users.update', 'users.status'],
  roles: ['roles.read'],
  settings: ['settings.read', 'settings.update'],
  categories: ['categories.read', 'categories.create', 'categories.update'],
  products: ['products.read', 'products.create', 'products.update'],
  ingredients: ['ingredients.read', 'ingredients.create', 'ingredients.update'],
  suppliers: ['suppliers.read', 'suppliers.create', 'suppliers.update'],
  recipes: ['recipes.read', 'recipes.update'],
  inventory: ['inventory.read', 'inventory.adjust'],
  purchases: ['purchases.read', 'purchases.create'],
  sales: ['sales.read', 'sales.create'],
  tables: ['tables.read', 'tables.create', 'tables.update'],
  orders: ['orders.read', 'orders.create', 'orders.update', 'orders.checkout'],
  cash: ['cash.read', 'cash.open', 'cash.close'],
  expenses: ['expenses.read', 'expenses.create', 'expenses.update'],
  reports: ['reports.read', 'reports.pdf'],
  delivery: ['delivery.read', 'delivery.assign', 'delivery.update'],
} as const;

async function main() {
  const databaseName = getDatabaseName();
  const allowLiveSeed = process.env.SEED_ALLOW_LIVE_DATABASE === 'true';

  if (!isTestDatabase(databaseName) && !allowLiveSeed) {
    throw new Error(
      `Seed bloqueado para proteger la base viva (${databaseName ?? 'desconocida'}). Usa SEED_ALLOW_LIVE_DATABASE=true solo si de verdad quieres sembrarla.`,
    );
  }

  await prisma.$executeRaw`SELECT pg_advisory_lock(${SEED_ADVISORY_LOCK_ID})`;

  try {
    const allPermissions = [...new Set(Object.values(permissionsByModule).flat())];

    await prisma.permission.createMany({
      data: allPermissions.map((code) => ({
        code,
        description: code,
      })),
      skipDuplicates: true,
    });

    const permissions = await prisma.permission.findMany();
    const permissionMap = new Map(permissions.map((permission) => [permission.code, permission.id]));

  const roles = {
    admin: allPermissions,
    supervisor: [
      ...permissionsByModule.auth,
      ...permissionsByModule.roles,
      ...permissionsByModule.users,
      ...permissionsByModule.settings,
      ...permissionsByModule.sales,
      ...permissionsByModule.tables,
      ...permissionsByModule.orders,
      ...permissionsByModule.cash,
      ...permissionsByModule.expenses,
      ...permissionsByModule.reports,
      ...permissionsByModule.delivery,
    ],
    cashier: [
      ...permissionsByModule.auth,
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
      'delivery.read',
      'delivery.assign',
      'delivery.update',
    ],
    inventory: [
      ...permissionsByModule.auth,
      ...permissionsByModule.categories,
      ...permissionsByModule.products,
      ...permissionsByModule.ingredients,
      ...permissionsByModule.suppliers,
      ...permissionsByModule.recipes,
      ...permissionsByModule.inventory,
      ...permissionsByModule.purchases,
      'tables.read',
      'orders.read',
      'reports.read',
      'delivery.read',
    ],
    waiter: [
      ...permissionsByModule.auth,
      'tables.read',
      'orders.read',
      'orders.create',
      'orders.update',
      'products.read',
    ],
    delivery: [
      ...permissionsByModule.auth,
      'orders.read',
      'delivery.read',
      'delivery.update',
    ],
  } as const;

  for (const [name, permissionCodes] of Object.entries(roles)) {
    const uniquePermissionIds = [...new Set(permissionCodes)].map((code) => permissionMap.get(code)!);

    const role = await prisma.role.upsert({
      where: { name },
      update: {
        permissions: {
          deleteMany: {},
          create: uniquePermissionIds.map((permissionId) => ({
            permissionId,
          })),
        },
      },
      create: {
        name,
        description: `${name} role`,
        isSystem: true,
        permissions: {
          create: uniquePermissionIds.map((permissionId) => ({
            permissionId,
          })),
        },
      },
    });

    void role;
  }

  const [unitPiece, unitGram, unitMl] = await Promise.all([
    prisma.unit.upsert({
      where: { code: 'unit' },
      update: {},
      create: { code: 'unit', name: 'Unit', abbreviation: 'u' },
    }),
    prisma.unit.upsert({
      where: { code: 'gram' },
      update: {},
      create: { code: 'gram', name: 'Gram', abbreviation: 'g' },
    }),
    prisma.unit.upsert({
      where: { code: 'ml' },
      update: {},
      create: { code: 'ml', name: 'Milliliter', abbreviation: 'ml' },
    }),
  ]);

  const categoryData = [
    ['hamburguesas', 'Hamburguesas'],
    ['bebidas', 'Bebidas'],
    ['aguas', 'Aguas'],
    ['combos', 'Combos'],
    ['insumos', 'Insumos'],
    ['empaques', 'Empaques'],
    ['adiciones', 'Adiciones'],
  ] as const;

  for (const [slug, name] of categoryData) {
    await prisma.category.upsert({
      where: { slug },
      update: { name },
      create: { slug, name },
    });
  }

  const paymentMethods = [
    ['cash', 'Efectivo'],
    ['nequi', 'Nequi'],
    ['daviplata', 'Daviplata'],
    ['transfer', 'Transferencia'],
    ['card', 'Tarjeta'],
  ] as const;

  for (const [code, name] of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { code },
      update: { name, isActive: true },
      create: { code, name, isActive: true },
    });
  }

  const diningTables = [
    { label: 'Mesa 1', area: 'Salón principal', capacity: 4 },
    { label: 'Mesa 2', area: 'Salón principal', capacity: 4 },
    { label: 'Mesa 3', area: 'Terraza', capacity: 2 },
    { label: 'Mesa 4', area: 'Terraza', capacity: 2 },
  ] as const;

  for (const table of diningTables) {
    await prisma.diningTable.upsert({
      where: { label: table.label },
      update: table,
      create: table,
    });
  }

  const supplierData = [
    {
      name: 'Distribuidora Central',
      contactName: 'Laura Compras',
      phone: '573001112233',
      email: 'compras@distribuidoracentral.local',
      address: 'Bogota, Colombia',
      notes: 'Proveedor base para bebidas e insumos secos',
    },
    {
      name: 'Frescos del Barrio',
      contactName: 'Carlos Mercado',
      phone: '573002223344',
      email: 'ventas@frescosdelbarrio.local',
      address: 'Bogota, Colombia',
      notes: 'Proveedor sugerido para verduras y reposición diaria',
    },
  ] as const;

  for (const supplier of supplierData) {
    await prisma.supplier.upsert({
      where: {
        taxId: supplier.email,
      },
      update: supplier,
      create: {
        ...supplier,
        taxId: supplier.email,
      },
    });
  }

  const settings = [
    {
      key: 'business.profile',
      category: 'business',
      description: 'Business basic profile',
      value: {
        name: '2x1 Burger Co',
        logoUrl: '',
        phone: '+57 3000000000',
        address: 'Bogota, Colombia',
        currency: 'COP',
      },
    },
    {
      key: 'pos.defaults',
      category: 'pos',
      description: 'POS default behavior',
      value: {
        receiptFooter: 'Gracias por tu compra',
        allowOpenSaleWithoutSession: false,
      },
    },
    {
      key: 'reports.daily-close',
      category: 'reports',
      description: 'Daily close display config',
      value: {
        printSignature: true,
        timezone: 'America/Bogota',
      },
    },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {
        category: setting.category,
        description: setting.description,
        value: setting.value,
      },
      create: setting,
    });
  }

  const ingredientSeed = [
    ['PAN-HAMB', 'Pan de hamburguesa', unitPiece.id, 1200, 80, 20],
    ['CARNE-100', 'Carne de hamburguesa', unitPiece.id, 2800, 80, 20],
    ['QUESO-LONJA', 'Queso lonja', unitPiece.id, 600, 100, 20],
    ['LECHUGA', 'Lechuga', unitPiece.id, 300, 50, 10],
    ['TOMATE', 'Tomate', unitPiece.id, 400, 50, 10],
    ['CEBOLLA', 'Cebolla', unitPiece.id, 250, 50, 10],
    ['SALSA-BASE', 'Salsas de la casa', unitPiece.id, 350, 60, 10],
    ['CAJA-HAMB', 'Empaque hamburguesa', unitPiece.id, 500, 100, 20],
    ['SERVILLETAS', 'Servilletas', unitPiece.id, 60, 200, 50],
    ['BOLSAS', 'Bolsas', unitPiece.id, 120, 200, 50],
    ['GAS', 'Gas', unitPiece.id, 20000, 5, 1],
  ] as const;

  const ingredientMap = new Map<string, string>();
  for (const [code, name, unitId, costPrice, currentStock, stockMin] of ingredientSeed) {
    const ingredient = await prisma.ingredient.upsert({
      where: { code },
      update: {
        name,
        unitId,
        costPrice,
        currentStock,
        stockMin,
      },
      create: {
        code,
        name,
        unitId,
        costPrice,
        currentStock,
        stockMin,
      },
    });
    ingredientMap.set(code, ingredient.id);
  }

  const connectPieceUnit = {
    connectOrCreate: {
      where: { code: 'piece' },
      create: { code: 'piece', name: 'Piece', abbreviation: 'pc' },
    },
  } as const;

  const connectCategory = (slug: 'hamburguesas' | 'bebidas' | 'aguas', name: string) => ({
    connectOrCreate: {
      where: { slug },
      create: { slug, name },
    },
  });

  const burgerProduct = await prisma.product.upsert({
    where: { code: 'HAMB-2X1' },
    update: {
      name: 'Hamburguesa 2x1',
      category: connectCategory('hamburguesas', 'Hamburguesas'),
      unit: connectPieceUnit,
      kind: ProductKind.PREPARED,
      brand: ProductBrand.HOUSE,
      salePrice: 20000,
      costPrice: 0,
      trackStock: false,
      currentStock: 0,
      stockMin: 0,
    },
    create: {
      code: 'HAMB-2X1',
      name: 'Hamburguesa 2x1',
      category: connectCategory('hamburguesas', 'Hamburguesas'),
      unit: connectPieceUnit,
      kind: ProductKind.PREPARED,
      brand: ProductBrand.HOUSE,
      salePrice: 20000,
      costPrice: 0,
      trackStock: false,
      currentStock: 0,
      stockMin: 0,
      description: 'Hamburguesa preparada con receta base',
    },
  });

  for (const product of beverageCatalog) {
    await prisma.product.upsert({
      where: { code: product.code },
      update: {
        name: product.name,
        category: connectCategory(
          product.categorySlug,
          product.categorySlug === 'aguas' ? 'Aguas' : 'Bebidas',
        ),
        unit: connectPieceUnit,
        kind: product.kind,
        brand: product.brand,
        salePrice: product.salePrice,
        costPrice: product.costPrice,
        trackStock: true,
        currentStock: product.currentStock,
        stockMin: product.stockMin,
        isActive: true,
        description: product.description,
      },
      create: {
        code: product.code,
        name: product.name,
        category: connectCategory(
          product.categorySlug,
          product.categorySlug === 'aguas' ? 'Aguas' : 'Bebidas',
        ),
        unit: connectPieceUnit,
        kind: product.kind,
        brand: product.brand,
        salePrice: product.salePrice,
        costPrice: product.costPrice,
        trackStock: true,
        currentStock: product.currentStock,
        stockMin: product.stockMin,
        isActive: true,
        description: product.description,
      },
    });
  }

  if (pruneSeedCatalog) {
    await prisma.product.updateMany({
      where: {
        category: {
          slug: {
            in: ['bebidas', 'aguas'],
          },
        },
        code: {
          notIn: beverageCatalog.map((product) => product.code),
        },
      },
      data: {
        isActive: false,
        currentStock: 0,
      },
    });
  }

  const burgerProductRecord = await prisma.product.findUniqueOrThrow({
    where: { code: 'HAMB-2X1' },
  });

  await prisma.recipe.upsert({
    where: { productId: burgerProductRecord.id },
    update: {
      name: 'Receta base Hamburguesa 2x1',
      yieldQuantity: 1,
      items: {
        deleteMany: {},
        create: [
          { ingredientId: ingredientMap.get('PAN-HAMB')!, quantity: 2 },
          { ingredientId: ingredientMap.get('CARNE-100')!, quantity: 2 },
          { ingredientId: ingredientMap.get('QUESO-LONJA')!, quantity: 2 },
          { ingredientId: ingredientMap.get('LECHUGA')!, quantity: 1 },
          { ingredientId: ingredientMap.get('TOMATE')!, quantity: 1 },
          { ingredientId: ingredientMap.get('CEBOLLA')!, quantity: 1 },
          { ingredientId: ingredientMap.get('SALSA-BASE')!, quantity: 1 },
          { ingredientId: ingredientMap.get('CAJA-HAMB')!, quantity: 1 },
          { ingredientId: ingredientMap.get('SERVILLETAS')!, quantity: 2 },
          { ingredientId: ingredientMap.get('BOLSAS')!, quantity: 1 },
        ],
      },
    },
    create: {
      productId: burgerProductRecord.id,
      name: 'Receta base Hamburguesa 2x1',
      yieldQuantity: 1,
      instructions: 'Armado estándar para operación diaria.',
      items: {
        create: [
          { ingredientId: ingredientMap.get('PAN-HAMB')!, quantity: 2 },
          { ingredientId: ingredientMap.get('CARNE-100')!, quantity: 2 },
          { ingredientId: ingredientMap.get('QUESO-LONJA')!, quantity: 2 },
          { ingredientId: ingredientMap.get('LECHUGA')!, quantity: 1 },
          { ingredientId: ingredientMap.get('TOMATE')!, quantity: 1 },
          { ingredientId: ingredientMap.get('CEBOLLA')!, quantity: 1 },
          { ingredientId: ingredientMap.get('SALSA-BASE')!, quantity: 1 },
          { ingredientId: ingredientMap.get('CAJA-HAMB')!, quantity: 1 },
          { ingredientId: ingredientMap.get('SERVILLETAS')!, quantity: 2 },
          { ingredientId: ingredientMap.get('BOLSAS')!, quantity: 1 },
        ],
      },
    },
  });

  const adminPasswordHash = await hash(process.env.ADMIN_PASSWORD ?? 'Admin12345*', 12);
  const cashierPasswordHash = await hash(process.env.CASHIER_PASSWORD ?? 'Cashier12345*', 12);
  const inventoryPasswordHash = await hash(process.env.INVENTORY_PASSWORD ?? 'Inventory12345*', 12);
  const waiterPasswordHash = await hash(process.env.WAITER_PASSWORD ?? 'Waiter12345*', 12);
  const deliveryPasswordHash = await hash(process.env.DELIVERY_PASSWORD ?? 'Delivery12345*', 12);
  const waiterAccessName = normalizeAccessName(
    process.env.WAITER_ACCESS_NAME ?? 'Mesero Principal',
  );
  const waiterAccessCode = process.env.WAITER_ACCESS_CODE ?? 'M124578';
  const waiterAccessCodeHash = await hash(waiterAccessCode, 12);
  const deliveryAccessName = normalizeAccessName(
    process.env.DELIVERY_ACCESS_NAME ?? 'Domiciliario Principal',
  );
  const deliveryAccessCode = process.env.DELIVERY_ACCESS_CODE ?? 'D124578';
  const deliveryAccessCodeHash = await hash(deliveryAccessCode, 12);
  const connectRole = (name: 'admin' | 'cashier' | 'inventory' | 'waiter' | 'delivery') => ({
    connectOrCreate: {
      where: { name },
      create: {
        name,
        description: `${name} role`,
        isSystem: true,
      },
    },
  });
  const adminUser = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL ?? 'admin@2x1burgerco.local' },
    update: {
      fullName: 'Administrador Principal',
      passwordHash: adminPasswordHash,
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ role: connectRole('admin') }],
      },
    },
    create: {
      email: process.env.ADMIN_EMAIL ?? 'admin@2x1burgerco.local',
      fullName: 'Administrador Principal',
      passwordHash: adminPasswordHash,
      isActive: true,
      roles: {
        create: [{ role: connectRole('admin') }],
      },
    },
  });

  const cashierUser = await prisma.user.upsert({
    where: { email: process.env.CASHIER_EMAIL ?? 'cashier@2x1burgerco.local' },
    update: {
      fullName: 'Cajero Principal',
      passwordHash: cashierPasswordHash,
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ role: connectRole('cashier') }],
      },
    },
    create: {
      email: process.env.CASHIER_EMAIL ?? 'cashier@2x1burgerco.local',
      fullName: 'Cajero Principal',
      passwordHash: cashierPasswordHash,
      isActive: true,
      roles: {
        create: [{ role: connectRole('cashier') }],
      },
    },
  });

  const inventoryUser = await prisma.user.upsert({
    where: { email: process.env.INVENTORY_EMAIL ?? 'inventory@2x1burgerco.local' },
    update: {
      fullName: 'Responsable de Inventario',
      passwordHash: inventoryPasswordHash,
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ role: connectRole('inventory') }],
      },
    },
    create: {
      email: process.env.INVENTORY_EMAIL ?? 'inventory@2x1burgerco.local',
      fullName: 'Responsable de Inventario',
      passwordHash: inventoryPasswordHash,
      isActive: true,
      roles: {
        create: [{ role: connectRole('inventory') }],
      },
    },
  });
  const waiterUser = await prisma.user.upsert({
    where: { email: process.env.WAITER_EMAIL ?? 'waiter@2x1burgerco.local' },
    update: {
      fullName: 'Mesero Principal',
      accessName: waiterAccessName,
      accessCodeHash: waiterAccessCodeHash,
      passwordHash: waiterPasswordHash,
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ role: connectRole('waiter') }],
      },
    },
    create: {
      email: process.env.WAITER_EMAIL ?? 'waiter@2x1burgerco.local',
      fullName: 'Mesero Principal',
      accessName: waiterAccessName,
      accessCodeHash: waiterAccessCodeHash,
      passwordHash: waiterPasswordHash,
      isActive: true,
      roles: {
        create: [{ role: connectRole('waiter') }],
      },
    },
  });
  const deliveryUser = await prisma.user.upsert({
    where: { email: process.env.DELIVERY_EMAIL ?? 'delivery@2x1burgerco.local' },
    update: {
      fullName: 'Domiciliario Principal',
      accessName: deliveryAccessName,
      accessCodeHash: deliveryAccessCodeHash,
      passwordHash: deliveryPasswordHash,
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ role: connectRole('delivery') }],
      },
    },
    create: {
      email: process.env.DELIVERY_EMAIL ?? 'delivery@2x1burgerco.local',
      fullName: 'Domiciliario Principal',
      accessName: deliveryAccessName,
      accessCodeHash: deliveryAccessCodeHash,
      passwordHash: deliveryPasswordHash,
      isActive: true,
      roles: {
        create: [{ role: connectRole('delivery') }],
      },
    },
  });

    console.log('Seed completed');
    console.log(`Admin email: ${adminUser.email}`);
    console.log('Admin password: <redacted>');
    console.log(`Cashier email: ${cashierUser.email}`);
    console.log('Cashier password: <redacted>');
    console.log(`Inventory email: ${inventoryUser.email}`);
    console.log('Inventory password: <redacted>');
    console.log(`Waiter email: ${waiterUser.email}`);
    console.log(`Waiter access name: ${process.env.WAITER_ACCESS_NAME ?? 'Mesero Principal'}`);
    console.log('Waiter access code: <redacted>');
    console.log(`Delivery email: ${deliveryUser.email}`);
    console.log(`Delivery access name: ${process.env.DELIVERY_ACCESS_NAME ?? 'Domiciliario Principal'}`);
    console.log('Delivery access code: <redacted>');
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${SEED_ADVISORY_LOCK_ID})`;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
