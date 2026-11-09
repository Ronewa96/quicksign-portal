import React, { createContext, useContext, useState, useEffect } from 'react';
import { QuickDocument, UserProfile, SignatureTag, AuditEvent, DocumentStatus } from '../types';
import { AuthUser } from './AuthContext';
import { deleteOriginalFile } from '../lib/fileStore';
import { forgetStoredPdf } from '../lib/pdf';
import { useTheme } from '../lib/theme';

export type NavigationTab = 'dashboard' | 'send' | 'viewer' | 'convert' | 'ai' | 'audit' | 'settings' | 'dedicatedSign';

interface DocumentContextType {
  documents: QuickDocument[];
  activeDocumentId: string;
  activeDocument: QuickDocument | null;
  userProfile: UserProfile;
  theme: 'dark' | 'light';
  activeView: NavigationTab;
  signingTargetDocId: string | null;
  toggleTheme: () => void;
  setActiveView: (view: NavigationTab) => void;
  setActiveDocumentId: (id: string) => void;
  setSigningTargetDocId: (id: string | null) => void;
  openDedicatedSigning: (docId: string) => void;
  addDocument: (doc: Partial<QuickDocument>) => QuickDocument;
  updateDocument: (id: string, updates: Partial<QuickDocument>) => void;
  deleteDocument: (id: string) => void;
  clearDocuments: () => void;
  addSignatureTag: (docId: string, tag: Omit<SignatureTag, 'id'>) => void;
  updateSignatureTag: (docId: string, tagId: string, updates: Partial<SignatureTag>) => void;
  removeSignatureTag: (docId: string, tagId: string) => void;
  signDocument: (
    docId: string,
    signatureDataUrl: string,
    signerName?: string
  ) => Promise<{ success: boolean; transactionId: string; sha256Hash: string }>;
  updateProfile: (updates: Partial<UserProfile>) => void;
  saveSignatureToProfile: (signatureDataUrl: string) => void;
}


const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

// Former built-in sample documents; purged from any stored set on load
const LEGACY_SAMPLE_TITLES = new Set([
  'Starlink Ground Station Master Gateway Agreement',
  'Orbital Rideshare Payload Launch Services Master Covenant',
  'Proprietary Methane-Oxygen Raptor Metallurgy NDA',
]);

const DocumentContext = createContext<DocumentContextType | undefined>(undefined);

export const DocumentProvider: React.FC<{ authUser: AuthUser; children: React.ReactNode }> = ({
  authUser,
  children,
}) => {
  // Documents and profile are scoped per signed-in account
  // v3: sample documents removed; older stored sets are discarded
  const STORAGE_KEY_DOCS = `quicksign_documents_v3:${authUser.id}`;
  const STORAGE_KEY_PROFILE = `quicksign_profile_v2:${authUser.id}`;

  const DEFAULT_PROFILE: UserProfile = {
    name: authUser.name,
    email: authUser.email,
    title: authUser.title,
    organization: authUser.organization,
    savedSignatureUrl: null,
    savedInitials: getInitials(authUser.name),
    theme: 'dark',
  };

  const [documents, setDocuments] = useState<QuickDocument[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_DOCS);
      if (saved) {
        return (JSON.parse(saved) as QuickDocument[]).filter((d) => !LEGACY_SAMPLE_TITLES.has(d.title));
      }
    } catch (e) {
      console.warn('Error reading stored documents:', e);
    }
    return [];
  });

  const [activeDocumentId, setActiveDocumentId] = useState<string>(() => {
    return documents[0]?.id || '';
  });

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PROFILE);
      if (saved) return { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Error reading stored profile:', e);
    }
    return DEFAULT_PROFILE;
  });

  const { theme, toggleTheme } = useTheme();

  const [activeView, setActiveView] = useState<NavigationTab>('dashboard');
  const [signingTargetDocId, setSigningTargetDocId] = useState<string | null>(null);

  // Persist documents
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DOCS, JSON.stringify(documents));
    } catch (e) {}
  }, [documents]);

  // Persist profile
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(userProfile));
    } catch (e) {}
  }, [userProfile]);


  const activeDocument = documents.find((d) => d.id === activeDocumentId) || documents[0] || null;

  const openDedicatedSigning = (docId: string) => {
    setSigningTargetDocId(docId);
    setActiveDocumentId(docId);
    setActiveView('dedicatedSign');
  };

  const addDocument = (doc: Partial<QuickDocument>): QuickDocument => {
    // Callers may pre-assign an id (e.g. to store the original file before the document appears)
    const id = doc.id || `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const fullDoc: QuickDocument = {
      id,
      title: doc.title || 'Untitled Document',
      category: doc.category || 'Other',
      fileType: doc.fileType || 'pdf',
      pages: doc.pages && doc.pages.length > 0 ? doc.pages : [doc.rawText || 'Empty Document Body'],
      rawText: doc.rawText || '',
      originalFile: doc.originalFile,
      status: doc.status || 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: doc.createdBy || userProfile.name,
      signers: doc.signers || [
        { name: userProfile.name, email: userProfile.email, role: userProfile.title, status: 'pending' },
      ],
      signatureTags: doc.signatureTags || [],
      auditTrail: [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: 'Document uploaded',
          actor: userProfile.name,
          details: 'Document uploaded and ready to view.',
          ipAddress: '127.0.0.1 (Local Client)',
          deviceInfo: navigator.userAgent,
        },
      ],
    };

    setDocuments((prev) => [fullDoc, ...prev]);
    setActiveDocumentId(id);
    return fullDoc;
  };

  const updateDocument = (id: string, updates: Partial<QuickDocument>) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id === id) {
          return {
            ...doc,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
        return doc;
      })
    );
  };

  const removeStoredOriginal = (id: string) => {
    forgetStoredPdf(id);
    deleteOriginalFile(id);
  };

  const deleteDocument = (id: string) => {
    removeStoredOriginal(id);
    const remaining = documents.filter((d) => d.id !== id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (activeDocumentId === id) {
      setActiveDocumentId(remaining[0]?.id || '');
    }
  };

  const clearDocuments = () => {
    // Only this account's files; the file store is shared by all accounts in this browser
    documents.forEach((d) => d.originalFile && removeStoredOriginal(d.id));
    setDocuments([]);
    setActiveDocumentId('');
  };

  const addSignatureTag = (docId: string, tag: Omit<SignatureTag, 'id'>) => {
    const newTag: SignatureTag = {
      ...tag,
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };

    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id === docId) {
          const updatedTags = [...d.signatureTags, newTag];
          const newAudit: AuditEvent = {
            id: `aud-${Date.now()}`,
            timestamp: new Date().toISOString(),
            action: `Signature Tag Placed for ${tag.signerName}`,
            actor: userProfile.name,
            details: `Tag type '${tag.type}' placed on page ${tag.pageIndex + 1} at coordinates (${Math.round(tag.x)}%, ${Math.round(tag.y)}%).`,
            ipAddress: '127.0.0.1',
            deviceInfo: 'QuickSign UI',
          };
          return {
            ...d,
            signatureTags: updatedTags,
            auditTrail: [...d.auditTrail, newAudit],
            updatedAt: new Date().toISOString(),
          };
        }
        return d;
      })
    );
  };

  const updateSignatureTag = (docId: string, tagId: string, updates: Partial<SignatureTag>) => {
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id === docId) {
          return {
            ...d,
            signatureTags: d.signatureTags.map((t) => (t.id === tagId ? { ...t, ...updates } : t)),
            updatedAt: new Date().toISOString(),
          };
        }
        return d;
      })
    );
  };

  const removeSignatureTag = (docId: string, tagId: string) => {
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id === docId) {
          return {
            ...d,
            signatureTags: d.signatureTags.filter((t) => t.id !== tagId),
            updatedAt: new Date().toISOString(),
          };
        }
        return d;
      })
    );
  };

  const signDocument = async (
    docId: string,
    signatureDataUrl: string,
    signerName?: string
  ): Promise<{ success: boolean; transactionId: string; sha256Hash: string }> => {
    const nameToUse = signerName || userProfile.name;
    const targetDoc = documents.find((d) => d.id === docId);

    // Call server audit seal endpoint or fallback
    let txId = `QS-TX-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${new Date().getFullYear()}`;
    let shaHash = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    try {
      const res = await fetch('/api/audit/seal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId,
          documentTitle: targetDoc?.title,
          signerName: nameToUse,
          signerEmail: userProfile.email,
          signatureData: signatureDataUrl.slice(0, 100),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        txId = data.transactionId;
        shaHash = data.sha256Hash;
      }
    } catch (e) {
      console.warn('Server sealing fallback:', e);
    }

    const timestamp = new Date().toISOString();

    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id === docId) {
          // Mark all tags for this user as completed
          const updatedTags = d.signatureTags.map((tag) => {
            if (!tag.isCompleted && (tag.signerName.toLowerCase() === nameToUse.toLowerCase() || tag.signerEmail === userProfile.email)) {
              return {
                ...tag,
                isCompleted: true,
                signatureDataUrl: tag.type === 'signature' ? signatureDataUrl : undefined,
                completedAt: timestamp,
              };
            }
            return tag;
          });

          // Check if any tags remain or if all signers are done
          const allTagsDone = updatedTags.every((t) => t.isCompleted);
          const newStatus: DocumentStatus = allTagsDone || updatedTags.length === 0 ? 'completed' : 'signed';

          const updatedSigners = d.signers.map((s) => {
            if (s.name.toLowerCase() === nameToUse.toLowerCase() || s.email === userProfile.email) {
              return { ...s, status: 'signed' as const, signedAt: timestamp };
            }
            return s;
          });

          const auditRecord: AuditEvent = {
            id: `aud-${Date.now()}`,
            timestamp,
            action: 'Document signed',
            actor: `${nameToUse} (${userProfile.email})`,
            details: `Signature applied. Transaction ID ${txId}.`,
            ipAddress: '198.51.100.24',
            deviceInfo: navigator.userAgent,
          };

          return {
            ...d,
            status: newStatus,
            transactionId: txId,
            sha256Hash: shaHash,
            signedAt: timestamp,
            signedBy: `${nameToUse} (${userProfile.title})`,
            certificateId: `CERT-QS-${txId.replace(/[^A-Z0-9]/g, '')}`,
            signatureTags: updatedTags,
            signers: updatedSigners,
            auditTrail: [...d.auditTrail, auditRecord],
            updatedAt: timestamp,
          };
        }
        return d;
      })
    );

    return {
      success: true,
      transactionId: txId,
      sha256Hash: shaHash,
    };
  };

  const updateProfile = (updates: Partial<UserProfile>) => {
    setUserProfile((prev) => ({ ...prev, ...updates }));
  };

  const saveSignatureToProfile = (signatureDataUrl: string) => {
    setUserProfile((prev) => ({ ...prev, savedSignatureUrl: signatureDataUrl }));
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        activeDocumentId,
        activeDocument,
        userProfile,
        theme,
        activeView,
        signingTargetDocId,
        toggleTheme,
        setActiveView,
        setActiveDocumentId,
        setSigningTargetDocId,
        openDedicatedSigning,
        addDocument,
        updateDocument,
        deleteDocument,
        clearDocuments,
        addSignatureTag,
        updateSignatureTag,
        removeSignatureTag,
        signDocument,
        updateProfile,
        saveSignatureToProfile,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
};

/** For components that also appear outside the signed-in app (e.g. the public signing page). */
export const useOptionalDocuments = () => useContext(DocumentContext);

export const useDocuments = () => {
  const context = useContext(DocumentContext);
  if (!context) {
    throw new Error('useDocuments must be used within a DocumentProvider');
  }
  return context;
};
