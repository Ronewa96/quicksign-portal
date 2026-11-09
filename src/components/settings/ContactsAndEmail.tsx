import React, { useEffect, useState } from 'react';
import { Mail, Users, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';

interface Contact {
  name: string;
  email: string;
  role: string;
  lastUsed: string;
  timesUsed: number;
}

/** Email delivery status and the people this user has sent documents to. */
export const ContactsAndEmail: React.FC = () => {
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const loadContacts = () =>
    fetch('/api/contacts')
      .then((res) => (res.ok ? res.json() : { contacts: [] }))
      .then((data) => setContacts(data.contacts || []))
      .catch(() => setContacts([]));

  useEffect(() => {
    fetch('/api/email/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setEmailConfigured(data ? Boolean(data.configured) : null))
      .catch(() => setEmailConfigured(null));
    loadContacts();
  }, []);

  const removeContact = async (contact: Contact) => {
    if (!window.confirm(`Remove ${contact.name} (${contact.email}) from your contacts?`)) return;
    await fetch(`/api/contacts/${encodeURIComponent(contact.email)}`, { method: 'DELETE' });
    loadContacts();
  };

  return (
    <>
      <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-cyan-400">
          <Mail className="w-3.5 h-3.5" />
          <span>04. Email</span>
        </div>
        {emailConfigured === true && (
          <p className="flex items-start gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Email is connected. Signing requests, notifications, and signed copies are delivered by email.</span>
          </p>
        )}
        {emailConfigured === false && (
          <div className="flex items-start gap-2 text-xs text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>Email is not connected yet. Emails are saved to the server's data/outbox folder instead of being sent.</p>
              <p className="text-zinc-400">
                To send real emails, add your email account's SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS) to the
                server's .env file and restart the server. See .env.example for Gmail and Brevo examples.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-cyan-400">
            <Users className="w-3.5 h-3.5" />
            <span>05. Contacts</span>
          </div>
          <span className="text-[11px] font-mono text-zinc-500">{contacts.length}</span>
        </div>
        <p className="text-xs text-zinc-400">
          People you send documents to are remembered here and suggested when you add signers.
        </p>
        {contacts.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">No contacts yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded">
            {contacts.map((c) => (
              <div key={c.email} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{c.name}</div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {c.email}
                    {c.role ? ` · ${c.role}` : ''} · used {c.timesUsed} time{c.timesUsed === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  onClick={() => removeContact(c)}
                  className="p-1.5 text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                  title="Remove contact"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
