const API_URL = process.env.API_URL ?? 'http://localhost:4300';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@2x1burger.co';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRUNE_SYNC_CATALOG = process.env.BEVERAGE_SYNC_PRUNE === 'true';
const ALLOW_CATALOG_SYNC = process.env.CATALOG_SYNC_ALLOW_WRITE === 'true';

if (!ALLOW_CATALOG_SYNC) {
  console.error(
    'Catalog sync bloqueado para proteger datos vivos. Usa CATALOG_SYNC_ALLOW_WRITE=true solo cuando decidas sincronizar el catálogo explícitamente.',
  );
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD es obligatorio para sincronizar catálogo.');
  process.exit(1);
}

function beverage(code, name, salePrice, costPrice, currentStock, stockMin, description) {
  return {
    code,
    name,
    category: 'Bebidas',
    brand: 'COCA_COLA',
    salePrice,
    costPrice,
    currentStock,
    stockMin,
    description,
  };
}

const beverageCatalog = [
  beverage('CC-ORG-1500', 'Coca-Cola Original 1.5 L', 9000, 0, 10, 4, 'COCA-COLA · 1500 ml'),
  beverage('CC-ORG-400', 'Coca-Cola Original 400 ml', 4000, 0, 18, 6, 'COCA-COLA · 400 ml'),
  { code: 'AIN-LIM-600', name: 'Agua INN Limón 600 ml', category: 'Aguas', brand: 'OTHER', salePrice: 3500, costPrice: 0, currentStock: 12, stockMin: 4, description: 'AGUA INN · 600 ml' },
  { code: 'ABLU-600', name: 'Agua Blu 600 ml', category: 'Aguas', brand: 'OTHER', salePrice: 3500, costPrice: 0, currentStock: 12, stockMin: 4, description: 'AGUA BLU · 600 ml' },
  { code: 'EGO-FRU-355', name: 'Ego Frutas 355 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 17000, costPrice: 0, currentStock: 8, stockMin: 2, description: 'EGO FRUTAS · 355 ml' },
  { code: 'OMNI-FXNAR-355', name: 'OMNILIFE FX Naranja 355 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 7000, costPrice: 0, currentStock: 10, stockMin: 3, description: 'OMNILIFE FX · NARANJA · 355 ml' },
  { code: 'OMNI-FXMAN-355', name: 'OMNILIFE FX Manzana 355 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 7000, costPrice: 0, currentStock: 10, stockMin: 3, description: 'OMNILIFE FX · MANZANA · 355 ml' },
  { code: 'POKER-330', name: 'Cerveza Poker 330 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 4000, costPrice: 0, currentStock: 16, stockMin: 6, description: 'CERVEZA POKER · 330 ml' },
  { code: 'COLAPOLA-330', name: 'Cola & Pola 330 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 4000, costPrice: 0, currentStock: 16, stockMin: 6, description: 'COLA & POLA · 330 ml' },
  { code: 'CLUBCOL-269', name: 'Cerveza Club Colombia 269 ml', category: 'Bebidas', brand: 'OTHER', salePrice: 5000, costPrice: 0, currentStock: 12, stockMin: 4, description: 'CLUB COLOMBIA · 269 ml' },
];

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path}: ${response.status} ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

const login = await apiFetch('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  }),
});

const authHeaders = {
  Authorization: `Bearer ${login.accessToken}`,
  'X-Audit-Source': 'catalog_sync',
  'X-Audit-Reason': 'Sincronización controlada del catálogo de bebidas y aguas',
};

const [products, categories, units] = await Promise.all([
  apiFetch('/products', { headers: authHeaders }),
  apiFetch('/categories', { headers: authHeaders }),
  apiFetch('/units', { headers: authHeaders }),
]);

const categoryMap = new Map(categories.map((category) => [category.name, category.id]));
const unit = units.find((entry) => entry.code === 'unit');

if (!unit) {
  throw new Error('No se encontró la unidad base "unit".');
}

for (const product of beverageCatalog) {
  const categoryId = categoryMap.get(product.category);
  if (!categoryId) {
    throw new Error(`No se encontró la categoría ${product.category}.`);
  }

  const payload = {
    code: product.code,
    name: product.name,
    categoryId,
    unitId: unit.id,
    kind: 'DIRECT_STOCK',
    brand: product.brand,
    description: product.description,
    salePrice: product.salePrice,
    costPrice: product.costPrice,
    currentStock: product.currentStock,
    stockMin: product.stockMin,
    trackStock: true,
    isActive: true,
  };

  const existing = products.find((entry) => entry.code === product.code);

  if (existing) {
    await apiFetch(`/products/${existing.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    console.log(`updated ${product.code}`);
  } else {
    await apiFetch('/products', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    console.log(`created ${product.code}`);
  }
}

if (PRUNE_SYNC_CATALOG) {
  for (const product of products) {
    const categoryName = product.category?.name;
    const isDrinkFamily = categoryName === 'Bebidas' || categoryName === 'Aguas';
    if (!isDrinkFamily || beverageCatalog.some((entry) => entry.code === product.code)) {
      continue;
    }

    await apiFetch(`/products/${product.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        isActive: false,
        currentStock: 0,
      }),
    });
    console.log(`deactivated ${product.code}`);
  }
}

console.log(`sync complete: ${beverageCatalog.length} products`);
