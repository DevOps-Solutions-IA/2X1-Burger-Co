export const SOFIA_RETENTION_POLICY = {
  qrInboundRawSummariesDays: 30,
  messagePreviewsDays: 90,
  autoSafeDecisionEventsDays: 180,
  commercialRuleEventsDays: 180,
  humanFeedbackDays: 365,
  technicalLogsDays: 30,
  customerMemoryPolicy: 'retain_until_opt_out_or_manual_review',
  protectedDomains: ['orders', 'payments', 'pos', 'cash', 'stock', 'accounting'],
} as const;
