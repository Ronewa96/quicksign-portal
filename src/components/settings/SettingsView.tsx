import React, { useRef, useState } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { useAuth } from '../../context/AuthContext';
import { SignatureModal } from '../signing/SignatureModal';
import { ContactsAndEmail } from './ContactsAndEmail';
import { Avatar, prepareAvatar } from '../common/Avatar';
import {
  Camera,
  Trash2,
  RefreshCw,
  Settings,
  User,
  Mail,
  Building,
  Briefcase,
  PenTool,
  Shield,
  Sun,
  Moon,
  Check,
  RotateCcw,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { userProfile, updateProfile, theme, toggleTheme, saveSignatureToProfile } = useDocuments();

  const [name, setName] = useState(userProfile.name);
  const [email, setEmail] = useState(userProfile.email);
  const [title, setTitle] = useState(userProfile.title);
  const [organization, setOrganization] = useState(userProfile.organization);
  const [initials, setInitials] = useState(userProfile.savedInitials || 'AM');
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { user, updateAvatar, removeAvatar } = useAuth();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await updateAvatar(await prepareAvatar(file));
    } catch (err: any) {
      setPhotoError(err?.message || 'The photo could not be saved.');
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await removeAvatar();
    } catch (err: any) {
      setPhotoError(err?.message || 'The photo could not be removed.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({
      name,
      email,
      title,
      organization,
      savedInitials: initials,
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-y-auto">
      {/* Top Header */}
      <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-cyan-400" />
              <h1 className="text-xl font-bold tracking-tight text-white font-display">
                Profile & Settings
              </h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Update your details, your saved signature, and how the app looks.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl w-full mx-auto p-4 sm:p-8 space-y-8">
        <form onSubmit={handleSave} className="space-y-6">
          {/* Your details */}
          <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">
              01. Your Details
            </div>

            {/* Profile photo */}
            <div className="flex flex-wrap items-center gap-4 pb-4 border-b border-zinc-800/80">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoBusy}
                className="relative group rounded-full cursor-pointer disabled:cursor-wait"
                aria-label={user?.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
              >
                <Avatar src={user?.avatarUrl} initials={initials || 'AM'} size={72} className="border border-zinc-700" />
                <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {photoBusy ? <RefreshCw className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
                </span>
              </button>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-white">Profile photo</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-cyan-300 rounded cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{user?.avatarUrl ? 'Change photo' : 'Upload photo'}</span>
                  </button>
                  {user?.avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={photoBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-rose-400 rounded cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500">JPG, PNG or WebP. It is cropped to a square.</div>
                {photoError && <div className="text-[11px] text-rose-400">{photoError}</div>}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handlePhoto(e.target.files?.[0])}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Full Legal Name
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Job Title
                </label>
                <div className="relative">
                  <Briefcase className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Organization
                </label>
                <div className="relative">
                  <Building className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Initials
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={initials}
                  onChange={(e) => setInitials(e.target.value.toUpperCase())}
                  className="w-24 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Saved signature */}
          <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">
                02. Your Signature
              </div>
              <button
                type="button"
                onClick={() => setIsSigModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-cyan-300 rounded cursor-pointer transition-colors"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>{userProfile.savedSignatureUrl ? 'Update Signature' : 'Create Signature'}</span>
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Your saved signature is used when you click a signature box on a document, so you don't have to sign each time.
            </p>

            <div className="paper h-28 bg-white border border-zinc-300 rounded-md flex items-center justify-center p-4">
              {userProfile.savedSignatureUrl ? (
                <img
                  src={userProfile.savedSignatureUrl}
                  alt="Saved default signature"
                  className="max-h-20 object-contain filter drop-shadow"
                />
              ) : (
                <div className="text-xs text-zinc-600 italic">No saved signature configured yet.</div>
              )}
            </div>
          </div>

          {/* Interface Appearance & Environment */}
          <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">
              03. Appearance & Security
            </div>

            <div className="flex items-center justify-between py-2 border-b border-zinc-800/80">
              <div>
                <div className="text-xs font-semibold text-white">Theme</div>
                <div className="text-[11px] text-zinc-400">
                  {theme === 'dark' ? 'Dark mode is on' : 'Light mode is on'}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded text-xs text-zinc-200 cursor-pointer transition-colors"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
                <span>Switch Theme</span>
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-xs font-semibold text-white">Signature Records</div>
                <div className="text-[11px] text-zinc-400">
                  Every signed document gets a transaction ID and an entry in its audit trail.
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                <Shield className="w-3.5 h-3.5" />
                <span>ON</span>
              </div>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {saveSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  <span>Profile updated successfully!</span>
                </span>
              )}
            </div>

            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs rounded transition-all cursor-pointer shadow-sm"
            >
              <span>Save Changes</span>
            </button>
          </div>
        </form>

        <ContactsAndEmail />
      </div>

      <SignatureModal
        isOpen={isSigModalOpen}
        onClose={() => setIsSigModalOpen(false)}
        initialSignerName={name}
        onSave={(sigUrl) => {
          saveSignatureToProfile(sigUrl);
        }}
      />
    </div>
  );
};
