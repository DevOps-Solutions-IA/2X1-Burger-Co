import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { RecipesModule } from './modules/recipes/recipes.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { SalesModule } from './modules/sales/sales.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthModule } from './modules/health/health.module';
import { UnitsModule } from './modules/units/units.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { TablesModule } from './modules/tables/tables.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { SofiaModule } from './modules/sofia/sofia.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ReleaseModule } from './release/release.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CategoriesModule,
    ProductsModule,
    IngredientsModule,
    RecipesModule,
    InventoryModule,
    PurchasesModule,
    SuppliersModule,
    SalesModule,
    CashRegisterModule,
    ExpensesModule,
    ReportsModule,
    SettingsModule,
    HealthModule,
    UnitsModule,
    PaymentMethodsModule,
    TablesModule,
    OrdersModule,
    DeliveryModule,
    RealtimeModule,
    WhatsappModule,
    SofiaModule,
    ReleaseModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
