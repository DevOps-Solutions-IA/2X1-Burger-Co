'use client';

import { Search } from 'lucide-react';
import { QueryState } from '@/components/product';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PosProductGrid } from './PosProductGrid';
import type { Product } from './pos.types';

type ProductCategoryOption = {
  id: string;
  name: string;
};

type PosProductBrowserProps = {
  search: string;
  categoryFilter: string;
  categories: ProductCategoryOption[];
  filteredProducts: Product[];
  isLoading: boolean;
  isError: boolean;
  onSearchChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onAddToCart: (product: Product) => void;
  onRetry: () => void;
};

export function PosProductBrowser({
  search,
  categoryFilter,
  categories,
  filteredProducts,
  isLoading,
  isError,
  onSearchChange,
  onCategoryFilterChange,
  onAddToCart,
  onRetry,
}: PosProductBrowserProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="space-y-4 border-b border-stone-100 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold lg:text-[1.12rem]">Carta</h2>
            <p className="mt-1 text-sm text-stone-500">
              Busca por nombre o código, filtra por categoría y arma la venta o la comanda sin cortar el ritmo de atención.
            </p>
          </div>
          {!isLoading && !isError ? (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-bold text-brand-900">
              {filteredProducts.length} listos
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Busca por nombre, código o categoría"
              className="pl-9"
              data-testid="pos-search"
            />
          </div>
          <Select
            aria-label="Filtrar productos por categoría"
            value={categoryFilter}
            onChange={(event) => onCategoryFilterChange(event.target.value)}
          >
            <option value="ALL">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <QueryState
        status={isError ? 'error' : isLoading ? 'loading' : filteredProducts.length ? 'ready' : 'empty'}
        title={isError ? 'No pudimos cargar el catálogo' : 'No hay productos para este filtro'}
        description={isError ? 'No se pueden agregar productos hasta recuperar el catálogo real.' : 'Cambia la búsqueda o la categoría para continuar.'}
        onRetry={isError ? onRetry : undefined}
        className="m-5"
      >
        <PosProductGrid
          products={filteredProducts}
          isLoading={false}
          onAddToCart={onAddToCart}
        />
      </QueryState>
    </Card>
  );
}
