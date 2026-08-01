import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { AuthoritativeDeliveryQuoteAdapter } from '../delivery/delivery-quote.adapter';
import { AuditModule } from '../modules/audit/audit.module';
import { AuthoritativeAuditCommandAdapter } from '../modules/audit/audit-command.adapter';
import { CategoriesModule } from '../modules/categories/categories.module';
import { IngredientsModule } from '../modules/ingredients/ingredients.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { DomainAvailabilityAdapter } from '../modules/inventory/product-availability.adapter';
import { ProductsCatalogReadAdapter } from '../modules/products/catalog-read.adapter';
import { ProductsModule } from '../modules/products/products.module';
import { RecipesModule } from '../modules/recipes/recipes.module';
import {
  AUDIT_COMMAND_SERVICE,
  CATALOG_READ_SERVICE,
  DELIVERY_QUOTE_SERVICE,
  PRODUCT_AVAILABILITY_SERVICE,
  RECIPE_AVAILABILITY_SERVICE,
} from './contracts/sofia-domain-contracts';

@Module({
  imports: [ProductsModule, CategoriesModule, RecipesModule, IngredientsModule, InventoryModule, DeliveryModule, AuditModule],
  providers: [
    ProductsCatalogReadAdapter,
    DomainAvailabilityAdapter,
    AuthoritativeDeliveryQuoteAdapter,
    AuthoritativeAuditCommandAdapter,
    { provide: CATALOG_READ_SERVICE, useExisting: ProductsCatalogReadAdapter },
    { provide: PRODUCT_AVAILABILITY_SERVICE, useExisting: DomainAvailabilityAdapter },
    { provide: RECIPE_AVAILABILITY_SERVICE, useExisting: DomainAvailabilityAdapter },
    { provide: DELIVERY_QUOTE_SERVICE, useExisting: AuthoritativeDeliveryQuoteAdapter },
    { provide: AUDIT_COMMAND_SERVICE, useExisting: AuthoritativeAuditCommandAdapter },
  ],
  exports: [CATALOG_READ_SERVICE, PRODUCT_AVAILABILITY_SERVICE, RECIPE_AVAILABILITY_SERVICE, DELIVERY_QUOTE_SERVICE, AUDIT_COMMAND_SERVICE],
})
export class DomainContractsModule {}
