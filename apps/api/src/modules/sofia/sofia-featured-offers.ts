export type SofiaFeaturedOffer = {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  salesHint: string;
  sortOrder: number;
  isActive: boolean;
  linkedProductName: string | null;
  offerType: 'FAMILY' | 'PROMO' | 'LOADED' | 'CLASSIC';
};

export const SOFIA_FEATURED_OFFERS: SofiaFeaturedOffer[] = [
  {
    id: 'sofia-offer-maxi-family',
    slug: 'maxi-family',
    name: 'Maxi Family',
    description: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
    imageUrl: '/uploads/sofia-offers/maxi-family.webp',
    salesHint:
      'Ideal para compartir en familia o grupo. Incluye una porción personal de papitas; si quieren acompañar mejor el combo, se pueden agregar papitas adicionales.',
    sortOrder: 1,
    isActive: true,
    linkedProductName: null,
    offerType: 'FAMILY',
  },
  {
    id: 'sofia-offer-2x1-hamburguesas',
    slug: '2x1-hamburguesas',
    name: '2x1 Hamburguesas',
    description: '2 burgers',
    imageUrl: '/uploads/sofia-offers/2x1-hamburguesas.webp',
    salesHint: 'Ideal para compartir o para dos personas. Se puede completar con papitas y bebida.',
    sortOrder: 2,
    isActive: true,
    linkedProductName: 'Hamburguesa 2x1',
    offerType: 'PROMO',
  },
  {
    id: 'sofia-offer-doble-todo',
    slug: 'doble-todo',
    name: 'Doble Todo',
    description: 'doble carne + doble tocineta + doble queso cheddar en lonjas',
    imageUrl: '/uploads/sofia-offers/doble-todo.webp',
    salesHint: 'Ideal para quien quiere una burger más cargada y completa. Se puede acompañar con papitas o bebida.',
    sortOrder: 3,
    isActive: true,
    linkedProductName: null,
    offerType: 'LOADED',
  },
  {
    id: 'sofia-offer-hamburguesa-sencilla',
    slug: 'hamburguesa-sencilla',
    name: 'Hamburguesa Sencilla',
    description: '1 burger sencilla',
    imageUrl: '/uploads/sofia-offers/hamburguesa-sencilla.webp',
    salesHint: 'Ideal para algo rápido y clásico. Se puede mejorar con queso, tocineta, carne extra, papitas o bebida.',
    sortOrder: 4,
    isActive: true,
    linkedProductName: null,
    offerType: 'CLASSIC',
  },
];

export const SOFIA_FEATURED_OFFER_IMAGE_URLS = new Set(SOFIA_FEATURED_OFFERS.map((offer) => offer.imageUrl));

export function getActiveSofiaFeaturedOffers() {
  return SOFIA_FEATURED_OFFERS.filter((offer) => offer.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}
