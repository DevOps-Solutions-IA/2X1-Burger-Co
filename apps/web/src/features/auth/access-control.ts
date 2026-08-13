type RouteAccessPolicy = Readonly<{
  prefix: string;
  permission?: string;
  roles?: readonly string[];
}>;

export const routePermissionMap: readonly RouteAccessPolicy[] = [
  { prefix: '/activation-control', permission: 'settings.read' },
  { prefix: '/customer-service', permission: 'orders.read', roles: ['admin', 'supervisor'] },
  { prefix: '/conversations', permission: 'orders.read' },
  { prefix: '/customers', permission: 'orders.read' },
  { prefix: '/crm', permission: 'orders.read' },
  { prefix: '/payments', permission: 'reports.read', roles: ['admin', 'supervisor'] },
  { prefix: '/analytics', permission: 'reports.read' },
  { prefix: '/kitchen', permission: 'orders.read' },
  { prefix: '/orders', permission: 'orders.read' },
  { prefix: '/audit', permission: 'reports.read' },
  { prefix: '/team', permission: 'users.read' },
  { prefix: '/overview', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/sofia', permission: 'orders.read' },
  { prefix: '/dashboard', roles: ['admin', 'supervisor', 'cashier'] },
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
];

export function hasPermission(permissions: string[] | undefined, permission?: string) {
  if (!permission) {
    return true;
  }

  return (permissions ?? []).includes(permission);
}

export function hasAllowedRole(roles: string[] | undefined, allowedRoles?: readonly string[]) {
  if (!allowedRoles?.length) {
    return true;
  }

  return (roles ?? []).some((role) => allowedRoles.includes(role));
}

const CRM_MUTATION_ROLES = ['admin', 'supervisor'] as const;

export function canMutateCrm(roles: string[] | undefined) {
  return hasAllowedRole(roles, CRM_MUTATION_ROLES);
}

export function canAccessRoute(
  pathname: string,
  permissions: string[] | undefined,
  roles?: string[],
) {
  const matchedRoute = routePermissionMap.find(
    (route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`),
  );
  if (!matchedRoute) {
    return false;
  }

  return hasPermission(permissions, matchedRoute.permission)
    && hasAllowedRole(roles, matchedRoute.roles);
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
