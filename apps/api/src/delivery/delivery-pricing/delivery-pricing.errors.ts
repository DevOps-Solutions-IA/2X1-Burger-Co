export class DeliveryPricingInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryPricingInvalidInputError';
  }
}
