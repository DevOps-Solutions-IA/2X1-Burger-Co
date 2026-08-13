type RouteAccessPolicy = Readonly<{
  prefix: string;
  permission?: string;
  roles?: readonly string[];
}>;

export const routePermissionMap: readonly RouteAccessPolicy[] = [
  { prefix: '/activation-control', permission: 'settings.read' },
  { prefix: '/customer-service', permission: 'orders.read', roles: ['admin', 'supervisor'] },
  { prefix: '/conversations', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/customers', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/crm', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/payments', permission: 'reports.read', roles: ['admin', 'supervisor'] },
  { prefix: '/analytics', permission: 'reports.read' },
  { prefix: '/kitchen', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/orders', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/audit', permission: 'reports.read', roles: ['admin', 'supervisor'] },
  { prefix: '/team', permission: 'users.read' },
  { prefix: '/overview', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/sofia', permission: 'orders.read', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/dashboard', roles: ['admin', 'supervisor', 'cashier'] },
  { prefix: '/waiter', permission: 'orders.create' },
  { prefix: '/delivery', permission: 'delivery.read', roles: ['admin', 'supervisor', 'cashier', 'delivery', 'rider'] },
  { prefix: '/deliveries', permission: 'delivery.read', roles: ['admin', 'supervisor', 'cashier', 'delivery', 'rider'] },
  { prefix: '/categories', permission: 'categories.read' },
  { prefix: '/products', permission: 'products.read' },
  { prefix: '/ingredients', permission: 'ingredients.read' },
  { prefix: '/suppliers', permission: 'suppliers.read' },
  { prefix: '/purchases', permission: 'purchases.read' },
  { prefix: '/inventory', permission: 'inventory.read' },
  { prefix: '/tables', permission: 'tables.read', roles: ['admin', 'supervisor', 'cashier', 'waiter'] },
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

const DEFAULT_ROUTE_BY_ROLE = [
  { role: 'waiter', path: '/waiter' },
  { role: 'delivery', path: '/delivery' },
  { role: 'rider', path: '/delivery' },
  { role: 'admin', path: '/dashboard' },
  { role: 'supervisor', path: '/dashboard' },
  { role: 'cashier', path: '/dashboard' },
  { role: 'inventory', path: '/inventory' },
] as const;

export function canMutateCrm(roles: string[] | undefined, permissions: string[] | undefined) {
  return hasAllowedRole(roles, CRM_MUTATION_ROLES) && hasPermission(permissions, 'orders.update');
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

  const destination = DEFAULT_ROUTE_BY_ROLE.find(
    ({ role, path }) =>
      user.roles?.includes(role)
      && canAccessRoute(path, user.permissions, user.roles),
  );

  return destination?.path ?? '/login';
}
