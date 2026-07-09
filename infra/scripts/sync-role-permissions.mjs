import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
};

const rolePermissions = {
  admin: [...new Set(Object.values(permissionsByModule).flat())],
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
};

async function main() {
  const allPermissions = [...new Set(Object.values(permissionsByModule).flat())];

  await prisma.permission.createMany({
    data: allPermissions.map((code) => ({
      code,
      description: code,
    })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({
    where: {
      code: {
        in: allPermissions,
      },
    },
  });
  const permissionMap = new Map(permissions.map((permission) => [permission.code, permission.id]));

  for (const [roleName, codes] of Object.entries(rolePermissions)) {
    const uniquePermissionIds = [...new Set(codes)]
      .map((code) => permissionMap.get(code))
      .filter((value) => typeof value === 'string');

    await prisma.role.upsert({
      where: { name: roleName },
      update: {
        description: `${roleName} role`,
        isSystem: true,
        permissions: {
          deleteMany: {},
          create: uniquePermissionIds.map((permissionId) => ({
            permissionId,
          })),
        },
      },
      create: {
        name: roleName,
        description: `${roleName} role`,
        isSystem: true,
        permissions: {
          create: uniquePermissionIds.map((permissionId) => ({
            permissionId,
          })),
        },
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        roles: Object.keys(rolePermissions),
        permissions: allPermissions.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
