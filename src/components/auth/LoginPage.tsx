import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../common/ThemeToggle';
import {
  Mail,
  Lock,
  User,
  Building,
  Briefcase,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

type Mode = 'signin' | 'register' | 'forgot' | 'reset';

interface LoginPageProps {
  /** Token from a password-reset email link; shows the "choose a new password" form */
  resetToken?: string | null;
  onResetFinished?: () => void;
}

const HEADINGS: Record<Mode, [string, string]> = {
  signin: ['Sign in to QuickSign', 'Welcome back. Enter your credentials to continue.'],
  register: ['Create your account', 'Create an account to start signing documents.'],
  forgot: ['Reset your password', "Enter your account's email address and we'll send you a link to choose a new password."],
  reset: ['Choose a new password', 'Enter a new password for your account. You will be signed in afterwards.'],
};

export const LoginPage: React.FC<LoginPageProps> = ({ resetToken, onResetFinished }) => {
  const { login, register, requestPasswordReset, resetPassword } = useAuth();

  const [mode, setMode] = useState<Mode>(resetToken != null ? 'reset' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [title, setTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isRegister = mode === 'register';
  const needsNewPassword = mode === 'register' || mode === 'reset';

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
    if (mode === 'reset') onResetFinished?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (needsNewPassword && password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (mode === 'reset' && password !== confirmPassword) {
      setError('The two passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        await register({ name, email, password, title, organization });
      } else if (mode === 'forgot') {
        await requestPasswordReset(email);
        setNotice(`If an account exists for ${email.trim()}, we've emailed it a link to reset the password. Check your inbox (and spam folder). The link expires in 1 hour.`);
      } else if (mode === 'reset') {
        await resetPassword(resetToken || '', password);
        onResetFinished?.();
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full pl-9 pr-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 transition-colors';

  return (
    <div className="relative min-h-dvh w-full bg-zinc-950 text-zinc-100 font-sans antialiased flex">
      <ThemeToggle className="absolute top-3 right-3 z-10" />

      {/* Left brand panel */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between p-12 border-r border-zinc-800/80 bg-zinc-950/60 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#00f0ff 1px, transparent 1px), linear-gradient(90deg, #00f0ff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-zinc-950 font-bold text-sm tracking-wider font-display">
            QS
          </div>
          <span className="text-base font-semibold tracking-tight font-display">
            QuickSign <span className="text-zinc-500 font-normal">Portal</span>
          </span>
        </div>

        <div className="relative space-y-4 max-w-md">
          <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-400">
            DOCUMENT SIGNING MADE SIMPLE
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white font-display leading-tight">
            Sign, review, and manage your documents in one place.
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Sign documents online, get AI summaries, convert files, and keep a record of every step.
          </p>
        </div>

        {/* Spacer keeps the text above vertically centred */}
        <div />
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile wordmark */}
          <div className="flex lg:hidden items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-zinc-950 font-bold text-sm tracking-wider font-display">
              QS
            </div>
            <span className="text-base font-semibold tracking-tight font-display">
              QuickSign <span className="text-zinc-500 font-normal">Portal</span>
            </span>
          </div>

          <div>
            <h2 className="text-xl font-bold tracking-tight text-white font-display">{HEADINGS[mode][0]}</h2>
            <p className="text-xs text-zinc-400 mt-1">{HEADINGS[mode][1]}</p>
          </div>

          {/* Mode switch */}
          {(mode === 'signin' || mode === 'register') && (
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
            {(['signin', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-1.5 text-xs rounded transition-colors cursor-pointer ${
                  mode === m ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label htmlFor="name" className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Full Legal Name
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Lee"
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {mode !== 'reset' && (
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </div>
            </div>
            )}

            {mode !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-xs font-medium text-zinc-400">
                  {mode === 'reset' ? 'New Password' : 'Password'}
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={needsNewPassword ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={needsNewPassword ? 'At least 8 characters' : '••••••••'}
                  className={`${inputClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            )}

            {mode === 'reset' && (
              <div>
                <label htmlFor="confirm-password" className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Type it again"
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {isRegister && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="title" className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Job Title <span className="text-zinc-600">(optional)</span>
                  </label>
                  <div className="relative">
                    <Briefcase className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="title"
                      type="text"
                      autoComplete="organization-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Director"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="organization" className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Organization <span className="text-zinc-600">(optional)</span>
                  </label>
                  <div className="relative">
                    <Building className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="organization"
                      type="text"
                      autoComplete="organization"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Acme Corp"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-2.5 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="flex items-start gap-2 p-2.5 rounded border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-300"
              >
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs rounded transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <span>
                    {{ signin: 'Sign In', register: 'Create Account', forgot: 'Send Reset Link', reset: 'Set New Password' }[mode]}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {mode === 'forgot' || mode === 'reset' ? (
            <p className="text-center text-xs text-zinc-500">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
              >
                Back to sign in
              </button>
            </p>
          ) : (
            <p className="text-center text-xs text-zinc-500">
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <button
                type="button"
                onClick={() => switchMode(isRegister ? 'signin' : 'register')}
                className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
              >
                {isRegister ? 'Sign in' : 'Create one'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
