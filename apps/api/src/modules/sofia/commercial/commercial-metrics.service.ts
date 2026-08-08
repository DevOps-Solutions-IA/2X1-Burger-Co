import { Injectable } from '@nestjs/common';

const allowed = new Set(['commercial_intent_resolved', 'commercial_intent_ambiguous', 'draft_created', 'draft_updated', 'draft_confirmed', 'draft_expired', 'draft_rejected', 'handoff_requested', 'catalog_failure', 'availability_failure', 'delivery_quote_failure']);

@Injectable()
export class CommercialMetricsService {
  private readonly values = new Map<string, number>();
  increment(name: string) {
    if (!allowed.has(name)) return;
    this.values.set(name, (this.values.get(name) ?? 0) + 1);
  }
  snapshot() { return Object.fromEntries(this.values); }
}

