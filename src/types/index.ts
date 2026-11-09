export type DocumentStatus = 'draft' | 'pending' | 'signed' | 'completed';

export type TagType = 'signature' | 'initials' | 'date' | 'nameTag';

export interface SignatureTag {
  id: string;
  pageIndex: number;
  x: number; // percentage from left (0 - 100)
  y: number; // percentage from top (0 - 100)
  type: TagType;
  signerName: string;
  signerEmail?: string;
  isCompleted: boolean;
  signatureDataUrl?: string;
  completedAt?: string;
  /** Size multiplier for the signature image (1 = default 40px tall on the 820px page) */
  scale?: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  details: string;
  ipAddress: string;
  deviceInfo: string;
}

export interface QuickDocument {
  id: string;
  title: string;
  category: string;
  fileType: 'pdf' | 'docx' | 'md' | 'txt' | 'json';
  pages: string[];
  rawText: string;
  /** Present when the original upload is kept (IndexedDB, keyed by document id) and rendered as-is */
  originalFile?: {
    name: string;
    mimeType: string;
    size: number;
  };
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  signers: Array<{
    name: string;
    email: string;
    role: string;
    status: 'pending' | 'signed';
    signedAt?: string;
  }>;
  signatureTags: SignatureTag[];
  auditTrail: AuditEvent[];
  transactionId?: string;
  sha256Hash?: string;
  signedAt?: string;
  signedBy?: string;
  certificateId?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  title: string;
  organization: string;
  savedSignatureUrl: string | null;
  savedInitials: string;
  theme: 'dark' | 'light';
}

export interface RiskClause {
  title: string;
  level: 'low' | 'medium' | 'high';
  clauseSnippet?: string;
  explanation: string;
  recommendation: string;
}

export interface AIAnalysisResult {
  summary: string;
  keyPoints: string[];
  governingLaw?: string;
  identifiedParties?: string[];
  estimatedReviewTime?: string;
  readabilityGrade?: string;
  risks: RiskClause[];
  disclaimer: string;
}
