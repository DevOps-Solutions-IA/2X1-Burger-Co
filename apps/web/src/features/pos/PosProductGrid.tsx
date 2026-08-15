'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Product } from './pos.types';

export function PosProductGrid({
  products,
  isLoading,
  onAddToCart,
}: {
  products: Product[];
  isLoading: boolean;
  onAddToCart: (product: Product) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 p-6 sm:max-h-[29.25rem] sm:grid-cols-2 sm:overflow-y-auto sm:pr-4 sm:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {isLoading
        ? Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-[1.75rem]" />
          ))
        : null}

      {products.map((product) => {
        const isLowStock =
          product.kind === 'DIRECT_STOCK' &&
          Number(product.stockMin) > 0 &&
          Number(product.currentStock) <= Number(product.stockMin);
        const outOfStock =
          product.kind === 'DIRECT_STOCK' && Number(product.currentStock) <= 0;

        return (
          <button
            key={product.id}
            type="button"
            data-testid={`pos-product-${product.code.toLowerCase()}`}
            className={`flex min-h-[12.6rem] flex-col rounded-[1.4rem] border p-3.5 text-left transition ${outOfStock ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-60' : 'border-stone-200 bg-white hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-soft'}`}
            onClick={() => onAddToCart(product)}
            disabled={outOfStock}
          >
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge tone={product.kind === 'DIRECT_STOCK' ? 'success' : 'default'}>
                  {product.kind === 'DIRECT_STOCK' ? 'Stock directo' : 'Preparado'}
                </Badge>
                {isLowStock ? <Badge tone="danger">Stock bajo</Badge> : null}
                {outOfStock ? <Badge tone="danger">Sin stock</Badge> : null}
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                {product.category.name}
              </p>
            </div>

            <div className="mt-3 flex-1">
              <p className="line-clamp-2 text-[1rem] font-semibold leading-tight text-ink lg:text-[1.05rem]">{product.name}</p>
              <p className="mt-1 text-[12px] font-medium text-stone-500">{product.code}</p>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">Precio</p>
                <p className="numeric-tabular mt-1 text-[1.15rem] font-bold leading-none text-ink">
                  {formatCurrency(product.salePrice)}
                </p>
              </div>
              {product.kind === 'DIRECT_STOCK' ? (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">Stock</p>
                  <p className={`numeric-tabular mt-1 text-[13px] font-bold leading-none ${outOfStock ? 'text-danger' : isLowStock ? 'text-amber-600' : 'text-ink'}`}>
                    {formatNumber(product.currentStock)}
                  </p>
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
