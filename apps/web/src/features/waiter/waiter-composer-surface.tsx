'use client';

import { memo, useEffect, useState } from 'react';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { formatCurrency } from '@/lib/format';
import { getCatalogWindow, WAITER_CATALOG_PAGE_SIZE } from './catalog-window';
import type { ActiveOrder, CartItem, DiningTable, Product } from './waiter-types';

type WaiterComposerSurfaceProps = {
  selectedTable: DiningTable;
  selectedOrder: ActiveOrder | null;
  cashState: { label: string; className: string };
  cashOpen: boolean;
  cashLoading: boolean;
  cashError: boolean;
  categories: string[];
  selectedCategory: string;
  products: Product[];
  productsLoading: boolean;
  productsFetching: boolean;
  productsError: boolean;
  cart: CartItem[];
  notes: string;
  saving: boolean;
  saveFeedback: 'saved' | 'error' | null;
  onClose: () => void;
  onRetryCash: () => void;
  onRetryProducts: () => void;
  onCategoryChange: (category: string) => void;
  onAddProduct: (product: Product) => void;
  onClearCart: () => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onNotesChange: (notes: string) => void;
  onSave: () => void;
};

function WaiterComposerSurfaceComponent({
  selectedTable,
  selectedOrder,
  cashState,
  cashOpen,
  cashLoading,
  cashError,
  categories,
  selectedCategory,
  products,
  productsLoading,
  productsFetching,
  productsError,
  cart,
  notes,
  saving,
  saveFeedback,
  onClose,
  onRetryCash,
  onRetryProducts,
  onCategoryChange,
  onAddProduct,
  onClearCart,
  onUpdateQuantity,
  onNotesChange,
  onSave,
}: WaiterComposerSurfaceProps) {
  const [visibleProductCount, setVisibleProductCount] = useState(WAITER_CATALOG_PAGE_SIZE);

  useEffect(() => {
    setVisibleProductCount(WAITER_CATALOG_PAGE_SIZE);
  }, [selectedCategory, selectedTable.id]);

  const productWindow = getCatalogWindow(products, visibleProductCount);

  return (
    <>
      <div className="-mx-3.5 -mt-3.5 mb-4 rounded-t-2xl bg-black px-4 py-4 sm:-mx-5 sm:-mt-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-stone-200 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/30" aria-label="Cerrar comanda y volver a las mesas"><X className="h-5 w-5" /></button>
            <div>
              <h1 className="text-[1.2rem] font-extrabold text-white">{selectedTable.label}</h1>
              <p className="text-xs text-stone-300">{selectedOrder ? `Comanda ${selectedOrder.number} · ${formatCurrency(selectedOrder.subtotal)}` : 'Nueva comanda'}</p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${cashState.className}`}>{cashState.label}</span>
        </div>
      </div>

      {cashError ? <StatusBanner tone="danger" title="No podemos confirmar el estado de caja" description="La comanda permanece en este dispositivo, pero guardar está bloqueado hasta recuperar el estado real." action={<Button variant="secondary" size="sm" onClick={onRetryCash}>Reintentar</Button>} /> : !cashLoading && !cashOpen ? <StatusBanner tone="warning" title="Caja cerrada" description="Abre caja para guardar pedidos." /> : null}

      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar" role="region" aria-label="Categorías de productos" tabIndex={0}>
        {categories.map((category) => (
          <button key={category} type="button" onClick={() => onCategoryChange(category)} aria-pressed={selectedCategory === category} className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 ${selectedCategory === category ? 'bg-brand-500 text-ink shadow-sm' : 'border border-stone-200 bg-white text-stone-500 hover:bg-stone-50'}`}>{category}</button>
        ))}
      </div>

      {productsError ? <StatusBanner tone="danger" title="Catálogo no disponible" description="No mostramos productos ni precios de memoria. Recupera el catálogo antes de agregar artículos." action={<Button variant="secondary" size="sm" onClick={onRetryProducts} disabled={productsFetching}>Reintentar</Button>} /> : productsLoading ? (
        <div className="grid grid-cols-2 gap-2" aria-label="Cargando productos" aria-busy="true">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-stone-100" aria-hidden="true" />)}</div>
      ) : products.length > 0 ? (
        <div>
          <div className="grid grid-cols-2 gap-2 pr-0.5">
            {productWindow.items.map((product) => (
              <button key={product.id} type="button" onClick={() => onAddProduct(product)} disabled={!product.isActive || (product.kind === 'DIRECT_STOCK' && Number(product.currentStock) <= 0)} className="min-h-24 rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-40">
                <p className="line-clamp-2 text-sm font-extrabold leading-tight text-ink">{product.name}</p>
                <div className="mt-2 flex items-center justify-between"><p className="text-sm font-black text-brand-900 tabular-nums">{formatCurrency(product.salePrice)}</p><span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-ink" aria-hidden="true"><Plus className="h-4 w-4" /></span></div>
              </button>
            ))}
          </div>
          {productWindow.hasMore ? <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => setVisibleProductCount(productWindow.nextVisibleCount)}>Mostrar {Math.min(WAITER_CATALOG_PAGE_SIZE, products.length - productWindow.items.length)} productos más</Button> : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center"><ShoppingBag className="mx-auto h-6 w-6 text-stone-400" /><p className="mt-2 text-sm font-bold text-stone-600">No hay productos en esta categoría</p></div>
      )}

      {cart.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/30 p-4">
          <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-extrabold text-ink">Comanda</p><p className="text-xs text-stone-500">{cart.length} artículos · Mesa {selectedTable.label}</p></div><button type="button" onClick={onClearCart} className="min-h-11 rounded-xl px-3 text-sm font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">Limpiar</button></div>
          <div className="space-y-1.5">
            {cart.map((item, index) => (
              <div key={`${item.productId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
                <span className="min-w-0 flex-1 text-sm font-bold text-ink">{item.name}</span><span className="text-sm font-extrabold text-ink tabular-nums">{formatCurrency(item.price * item.quantity)}</span>
                <div className="flex w-full items-center justify-between border-t border-stone-100 pt-2"><span className="text-xs font-semibold text-stone-500">Cantidad</span><div className="flex items-center gap-2"><button type="button" onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 hover:border-stone-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100" aria-label={`Quitar una unidad de ${item.name}`}><Minus className="h-4 w-4" /></button><span className="w-7 text-center text-sm font-bold tabular-nums" aria-label={`${item.quantity} unidades`}>{item.quantity}</span><button type="button" onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-ink hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100" aria-label={`Agregar una unidad de ${item.name}`}><Plus className="h-4 w-4" /></button></div></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-3"><span className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-stone-500">Total</span><span className="text-[1.2rem] font-black text-ink tabular-nums">{formatCurrency(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}</span></div>
        </div>
      ) : <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-6 text-center"><p className="text-[13px] font-bold text-stone-600">Carrito vacio</p><p className="mt-1 text-xs text-stone-600">Agrega productos desde el menu</p></div>}

      <div className="mt-4">
        <label htmlFor="waiter-order-notes" className="mb-2 block text-sm font-bold text-ink">Instrucciones de preparación</label>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">{['Sin cebolla', 'Sin salsas', 'Bien asada', 'Para llevar'].map((snippet) => <button key={snippet} type="button" onClick={() => onNotesChange(notes.includes(snippet) ? notes.replace(snippet, '').trim() : `${notes} ${snippet}`.trim())} aria-pressed={notes.includes(snippet)} className={`min-h-11 rounded-full px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 ${notes.includes(snippet) ? 'bg-brand-500 text-ink' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>{snippet}</button>)}</div>
        <div className="relative"><input id="waiter-order-notes" type="text" value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Instrucciones especiales..." className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 pr-12 text-base font-medium text-ink placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100" />{notes ? <button type="button" onClick={() => onNotesChange('')} className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100" aria-label="Borrar instrucciones"><X className="h-4 w-4" /></button> : null}</div>
      </div>

      <Button type="button" disabled={!cart.length || saving || !cashOpen} data-testid="waiter-save-order" onClick={onSave} className="mt-4 w-full rounded-2xl py-6 text-[14px] font-extrabold shadow-md">{saving ? 'Guardando...' : selectedOrder ? 'Actualizar comanda' : 'Guardar comanda'}</Button>
      {saveFeedback === 'saved' ? <div role="status" className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-sm font-bold text-emerald-800" data-testid="waiter-save-success-banner">Comanda guardada. POS ya puede verla.</div> : saveFeedback === 'error' ? <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center text-sm font-bold text-red-800" data-testid="waiter-save-error-banner">No pudimos guardar. Intenta nuevamente.</div> : null}
    </>
  );
}

export const WaiterComposerSurface = memo(WaiterComposerSurfaceComponent);
