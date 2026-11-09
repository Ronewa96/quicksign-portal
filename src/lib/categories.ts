/** Document categories, shared by the Send screen and the AI review (which suggests one of these). */
export const DOCUMENT_CATEGORIES = [
  'Non-Disclosure Agreement (NDA)',
  'Employment Contract',
  'Service Agreement',
  'Consulting Agreement',
  'Sales Contract',
  'Purchase Order',
  'Lease / Rental Agreement',
  'Partnership Agreement',
  'Loan Agreement',
  'Invoice / Quotation',
  'Other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
