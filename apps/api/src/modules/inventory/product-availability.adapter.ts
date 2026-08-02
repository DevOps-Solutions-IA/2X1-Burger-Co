import { Injectable } from '@nestjs/common';
import type { ProductAvailabilityService, RecipeAvailabilityService } from '../../application/contracts/sofia-domain-contracts';
import { IngredientsService } from '../ingredients/ingredients.service';
import { ProductsService } from '../products/products.service';
import { RecipesService } from '../recipes/recipes.service';
import { InventoryService } from './inventory.service';

@Injectable()
export class DomainAvailabilityAdapter implements ProductAvailabilityService, RecipeAvailabilityService {
  constructor(
    private readonly products: ProductsService,
    private readonly recipes: RecipesService,
    private readonly ingredients: IngredientsService,
    private readonly inventory: InventoryService,
  ) {}

  async check(input: { productId: string; quantity: number }) {
    const checkedAt = new Date().toISOString();
    const product = await this.products.findOne(input.productId);
    if (!product.isActive) return { productId: product.id, quantity: input.quantity, available: false, reasonCode: 'PRODUCT_INACTIVE', checkedAt, missingIngredients: [] };
    if (product.kind === 'DIRECT_STOCK' && product.trackStock) {
      const stock = await this.inventory.findStock();
      const current = stock.items.find((item) => item.itemType === 'PRODUCT' && item.id === product.id);
      const available = current !== undefined && current.currentStock >= input.quantity;
      return { productId: product.id, quantity: input.quantity, available, reasonCode: available ? 'AVAILABLE' : 'DIRECT_STOCK_INSUFFICIENT', checkedAt, missingIngredients: [] };
    }
    if (product.kind !== 'PREPARED' || !product.trackStock) {
      return { productId: product.id, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt, missingIngredients: [] };
    }
    const recipe = await this.recipes.findByProduct(product.id);
    if (!recipe?.isActive || !recipe.items.length || Number(recipe.yieldQuantity) <= 0) {
      return { productId: product.id, quantity: input.quantity, available: false, reasonCode: 'RECIPE_UNAVAILABLE', checkedAt, missingIngredients: [] };
    }
    const currentIngredients = new Map(
      await Promise.all(recipe.items.map(async (item) => [item.ingredientId, await this.ingredients.findOne(item.ingredientId)] as const)),
    );
    const missingIngredients = recipe.items.flatMap((item) => {
      const required = input.quantity * Number(item.quantity) / Number(recipe.yieldQuantity) * (1 + Number(item.wastePercent) / 100);
      const ingredient = currentIngredients.get(item.ingredientId);
      const available = Number(ingredient?.currentStock ?? 0);
      return !ingredient?.isActive || available < required
        ? [{ ingredientId: item.ingredientId, name: ingredient?.name ?? item.ingredient.name, required, available }]
        : [];
    });
    return { productId: product.id, quantity: input.quantity, available: missingIngredients.length === 0, reasonCode: missingIngredients.length ? 'INGREDIENT_STOCK_INSUFFICIENT' : 'AVAILABLE', checkedAt, missingIngredients };
  }
}
