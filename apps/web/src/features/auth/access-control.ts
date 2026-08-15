const routePermissionMap: Array<{ prefix: string; permission?: string }> = [
  { prefix: '/dashboard' },
  { prefix: '/waiter', permission: 'orders.create' },
  { prefix: '/delivery', permission: 'delivery.read' },
  { prefix: '/deliveries', permission: 'delivery.read' },
  { prefix: '/categories', permission: 'categories.read' },
  { prefix: '/products', permission: 'products.read' },
  { prefix: '/ingredients', permission: 'ingredients.read' },
  { prefix: '/suppliers', permission: 'suppliers.read' },
  { prefix: '/purchases', permission: 'purchases.read' },
  { prefix: '/inventory', permission: 'inventory.read' },
  { prefix: '/tables', permission: 'tables.read' },
  { prefix: '/pos', permission: 'sales.read' },
  { prefix: '/cash', permission: 'cash.read' },
  { prefix: '/expenses', permission: 'expenses.read' },
  { prefix: '/recipes', permission: 'recipes.read' },
  { prefix: '/reports', permission: 'reports.read' },
  { prefix: '/users', permission: 'users.read' },
  { prefix: '/settings', permission: 'settings.read' },
  { prefix: '/sofia', permission: 'settings.read' },
];

export function hasPermission(permissions: string[] | undefined, permission?: string) {
  if (!permission) {
    return true;
  }

  return (permissions ?? []).includes(permission);
}

export function canAccessRoute(pathname: string, permissions: string[] | undefined) {
  const matchedRoute = routePermissionMap.find((route) => pathname.startsWith(route.prefix));
  return hasPermission(permissions, matchedRoute?.permission);
}

export function resolveDefaultRoute(user: { roles?: string[]; permissions?: string[] } | null | undefined) {
  if (!user) {
    return '/login';
  }

  if (user.roles?.includes('waiter') && hasPermission(user.permissions, 'orders.create')) {
    return '/waiter';
  }

  if (user.roles?.includes('delivery') && hasPermission(user.permissions, 'delivery.read')) {
    return '/delivery';
  }

  return '/dashboard';
}
