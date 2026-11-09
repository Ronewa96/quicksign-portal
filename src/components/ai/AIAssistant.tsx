import React, { useState, useEffect, useRef } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { useAuth } from '../../context/AuthContext';
import { AIAnalysisResult } from '../../types';
import { extractTextFromFile, SUPPORTED_EXTENSIONS } from '../../lib/extractText';
import {
  Sparkles,
  Send,
  CheckCircle2,
  ShieldAlert,
  Scale,
  RefreshCw,
  FileText,
  Bot,
  User,
  Upload,
  History,
  Trash2,
  ArrowLeft,
  AlertCircle,
  Plus,
  Clock,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

interface AnalysisSession {
  id: string;
  title: string;
  fileName: string;
  text: string;
  analysis: AIAnalysisResult;
  createdAt: string;
}

const MAX_HISTORY = 20;
const MAX_STORED_TEXT = 60000;

const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const AIAssistant: React.FC = () => {
  const { documents } = useDocuments();
  const { user } = useAuth();
  const historyKey = `quicksign_ai_history_v1:${user?.id || 'anon'}`;

  // Analysis history (persisted per account)
  const [history, setHistory] = useState<AnalysisSession[]>(() => {
    try {
      const saved = localStorage.getItem(historyKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Error reading AI history:', e);
    }
    return [];
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSession = history.find((s) => s.id === activeSessionId) || null;

  // Upload / analysis state
  const [isLegalMode, setIsLegalMode] = useState(true);
  const [status, setStatus] = useState<'idle' | 'reading' | 'analyzing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Workspace state
  const [activeTab, setActiveTab] = useState<'risks' | 'chat'>('risks');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (e) {
      console.warn('Unable to persist AI history:', e);
    }
  }, [history, historyKey]);

  // Reset chat whenever a different analysis is opened
  useEffect(() => {
    if (!activeSession) {
      setMessages([]);
      return;
    }
    setActiveTab('risks');
    setMessages([
      {
        id: 'welcome',
        role: 'model',
        text: `Loaded "${activeSession.title}". Ask any question about its terms, obligations, liabilities, or deadlines.`,
        timestamp: formatTime(),
      },
    ]);
  }, [activeSessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatLoading]);

  const analyzeText = async (title: string, fileName: string, text: string) => {
    setStatus('analyzing');
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentTitle: title, documentText: text, isLegalMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? 'Your session has expired. Please sign in again.' : data.error || 'Analysis failed.'
        );
      }

      const session: AnalysisSession = {
        id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        fileName,
        text: text.slice(0, MAX_STORED_TEXT),
        analysis: data,
        createdAt: new Date().toISOString(),
      };
      setHistory((prev) => [session, ...prev].slice(0, MAX_HISTORY));
      setActiveSessionId(session.id);
    } finally {
      setStatus('idle');
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || status !== 'idle') return;
    setError(null);
    setStatus('reading');
    try {
      const text = await extractTextFromFile(file);
      await analyzeText(file.name.replace(/\.[^/.]+$/, ''), file.name, text);
    } catch (err: any) {
      setError(err?.message || 'Could not process this file.');
      setStatus('idle');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAnalyzeExisting = async (docId: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (!doc || status !== 'idle') return;
    setError(null);
    try {
      await analyzeText(doc.title, `${doc.title}.${doc.fileType}`, doc.rawText || doc.pages.join('\n\n'));
    } catch (err: any) {
      setError(err?.message || 'Analysis failed.');
    }
  };

  const deleteSession = (id: string) => {
    setHistory((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) setActiveSessionId(null);
  };

  const handleSendMessage = async (userPrompt?: string) => {
    const textToSend = userPrompt || inputMessage;
    if (!textToSend.trim() || isChatLoading || !activeSession) return;

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: textToSend, timestamp: formatTime() };
    setMessages((prev) => [...prev, userMsg]);
    if (!userPrompt) setInputMessage('');
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          documentTitle: activeSession.title,
          documentText: activeSession.text,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setMessages((prev) => [...prev, { id: `ai-${Date.now()}`, role: 'model', text: data.reply, timestamp: formatTime() }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'model',
          text: `Sorry, I couldn't answer that right now (${e?.message || 'network error'}). Please try again.`,
          timestamp: formatTime(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const quickQuestions = [
    'What are the key obligations?',
    'What are the payment terms?',
    'What is the termination notice period?',
    'Are there any liability caps?',
  ];

  const isBusy = status !== 'idle';
  const analysis = activeSession?.analysis;

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top Header Bar */}
      <div className="min-h-16 px-4 sm:px-8 py-2 border-b border-zinc-800/80 bg-zinc-950 flex items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-8 h-8 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white font-display">AI Assistant</h1>
            <p className="text-[11px] text-zinc-400 truncate">
              Upload a document to get a summary, risk clauses, and Q&A
            </p>
          </div>
        </div>

        {activeSession && (
          <button
            onClick={() => {
              setActiveSessionId(null);
              setError(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs rounded cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Upload</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Left Panel: Summary when a document is open, otherwise History */}
        <aside className="lg:w-96 shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-800/80 bg-zinc-950/60 flex flex-col min-h-0 max-h-[45vh] lg:max-h-none">
          {activeSession && analysis ? (
            <>
              <div className="px-5 py-3 border-b border-zinc-800/80 flex items-center justify-between">
                <button
                  onClick={() => setActiveSessionId(null)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>History</span>
                </button>
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">Summary</span>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-white font-display wrap-break-word">{activeSession.title}</h2>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono mt-1 flex-wrap">
                    <span className="truncate max-w-45">{activeSession.fileName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{analysis.estimatedReviewTime || '—'}</span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-line">{analysis.summary}</p>

                {analysis.keyPoints?.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 mb-2">Key Points</div>
                    <ul className="space-y-1.5 text-xs text-zinc-300">
                      {analysis.keyPoints.map((pt, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-1.5 pt-3 border-t border-zinc-800/80 text-[11px] font-mono">
                  {analysis.governingLaw && (
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500 shrink-0">Jurisdiction</span>
                      <span className="text-zinc-200 text-right">{analysis.governingLaw}</span>
                    </div>
                  )}
                  {analysis.identifiedParties && analysis.identifiedParties.length > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500 shrink-0">Parties</span>
                      <span className="text-zinc-200 text-right">{analysis.identifiedParties.join(', ')}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500 shrink-0">Risks found</span>
                    <span className="text-zinc-200">{analysis.risks?.length || 0}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>History</span>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm('Clear all analysis history?')) setHistory([]);
                    }}
                    className="text-[11px] text-zinc-500 hover:text-rose-400 cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {history.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-500">
                    No history yet. Documents you analyze will appear here.
                  </div>
                ) : (
                  history.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-start gap-2 p-3 rounded-md border border-zinc-800 bg-zinc-900/40 hover:border-cyan-500/40 hover:bg-zinc-900 transition-colors"
                    >
                      <button
                        onClick={() => setActiveSessionId(s.id)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-medium text-white">
                          <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{s.analysis.summary}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-zinc-500">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(s.createdAt).toLocaleString()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{s.analysis.risks?.length || 0} risks</span>
                        </div>
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        title="Delete from history"
                        aria-label={`Delete ${s.title} from history`}
                        className="p-1 text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </aside>

        {/* Right Workspace */}
        <section className="flex-1 min-h-0 flex flex-col">
          {!activeSession ? (
            /* Upload screen */
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center justify-center">
              <div className="w-full max-w-xl space-y-5">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    handleFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center justify-center gap-3 p-10 rounded-lg border-2 border-dashed text-center transition-colors ${
                    isBusy ? 'cursor-wait' : 'cursor-pointer'
                  } ${
                    isDragOver
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : 'border-zinc-700 bg-zinc-950 hover:border-cyan-500/60'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',')}
                    onChange={(e) => handleFile(e.target.files?.[0])}
                    disabled={isBusy}
                    className="hidden"
                  />
                  {isBusy ? (
                    <>
                      <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                      <span className="text-sm font-semibold text-white">
                        {status === 'reading' ? 'Reading document…' : 'Analyzing document…'}
                      </span>
                      <span className="text-xs text-zinc-500">This can take a few seconds.</span>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-semibold text-white">
                        Drop a document here or click to upload
                      </span>
                      <span className="text-xs text-zinc-500">PDF, DOCX, TXT, MD, HTML, or JSON · up to 15 MB</span>
                    </>
                  )}
                </label>

                <button
                  type="button"
                  onClick={() => setIsLegalMode(!isLegalMode)}
                  disabled={isBusy}
                  className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs transition-colors cursor-pointer border disabled:opacity-50 ${
                    isLegalMode
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>Legal Risk Detection: {isLegalMode ? 'ON' : 'OFF'}</span>
                </button>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300"
                  >
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="pt-2">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                      Or analyze one of your documents
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {documents.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => handleAnalyzeExisting(d.id)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white cursor-pointer disabled:opacity-50 max-w-full"
                        >
                          <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="truncate">{d.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="px-4 sm:px-8 border-b border-zinc-800/60 bg-zinc-950/60 flex items-center gap-6 text-xs font-medium shrink-0">
                <button
                  onClick={() => setActiveTab('risks')}
                  className={`py-3 transition-colors border-b-2 cursor-pointer ${
                    activeTab === 'risks'
                      ? 'border-cyan-400 text-white font-semibold'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Risk Clauses
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`py-3 transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'chat'
                      ? 'border-cyan-400 text-white font-semibold'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>Document Q&A</span>
                  <span className="text-[10px] font-mono px-1 rounded bg-zinc-800 text-zinc-400">{messages.length}</span>
                </button>
              </div>

              {activeTab === 'risks' && analysis && (
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-3 max-w-4xl w-full mx-auto">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-semibold text-white font-display">Identified Risk Clauses</h3>
                    </div>
                    <span className="text-xs font-mono text-zinc-400">{analysis.risks?.length || 0} found</span>
                  </div>

                  {(analysis.risks || []).length === 0 && (
                    <div className="p-6 text-center text-xs text-zinc-500 border border-zinc-800 rounded-lg">
                      No risk clauses identified.
                    </div>
                  )}

                  {analysis.risks?.map((risk, idx) => {
                    const isHigh = risk.level === 'high';
                    const isMed = risk.level === 'medium';
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border ${
                          isHigh
                            ? 'bg-rose-950/20 border-rose-500/30'
                            : isMed
                            ? 'bg-amber-950/20 border-amber-500/30'
                            : 'bg-zinc-950 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded ${
                              isHigh
                                ? 'bg-rose-500/20 text-rose-300'
                                : isMed
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {risk.level} Risk
                          </span>
                          <span className="text-xs font-semibold text-white font-display">{risk.title}</span>
                        </div>

                        {risk.clauseSnippet && (
                          <div className="mb-2 p-2 bg-black/40 border border-zinc-800/80 rounded font-mono text-[11px] text-zinc-300 italic">
                            "{risk.clauseSnippet}"
                          </div>
                        )}

                        <p className="text-xs text-zinc-300 leading-relaxed mb-2">{risk.explanation}</p>

                        <div className="text-[11px] text-cyan-300/90 bg-cyan-950/30 p-2 rounded border border-cyan-800/40">
                          <span className="font-semibold text-cyan-400">Recommended Action: </span>
                          {risk.recommendation}
                        </div>
                      </div>
                    );
                  })}

                  <div className="mt-4 p-4 bg-zinc-950/50 border border-zinc-800/60 rounded text-[11px] text-zinc-500 leading-relaxed">
                    <span className="font-semibold text-zinc-400">Notice: </span>
                    AI summaries and risk highlights are informational and do not constitute legal advice. Consult a
                    licensed attorney for binding determinations.
                  </div>
                </div>
              )}

              {activeTab === 'chat' && (
                <div className="flex-1 min-h-0 flex flex-col max-w-4xl w-full mx-auto p-3 sm:p-6">
                  <div className="flex items-center gap-2 pb-4 overflow-x-auto shrink-0">
                    {quickQuestions.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSendMessage(q)}
                        className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                    {messages.map((msg) => {
                      const isUser = msg.role === 'user';
                      return (
                        <div key={msg.id} className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs ${
                              isUser ? 'bg-zinc-700 text-white' : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400'
                            }`}
                          >
                            {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                          </div>
                          <div
                            className={`max-w-[75%] p-3.5 rounded-lg text-xs leading-relaxed ${
                              isUser
                                ? 'bg-white text-zinc-950 font-medium'
                                : 'bg-zinc-900 border border-zinc-800 text-zinc-200 whitespace-pre-wrap'
                            }`}
                          >
                            {msg.text}
                            <div className={`text-[9px] font-mono mt-1 text-zinc-500 ${isUser ? 'text-right' : ''}`}>
                              {msg.timestamp}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {isChatLoading && (
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                          <Bot className="w-3.5 h-3.5 animate-pulse" />
                        </div>
                        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                          <span>Reading the document…</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  <div className="pt-4 border-t border-zinc-800 shrink-0">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendMessage();
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder={`Ask a question about ${activeSession.title}...`}
                        className="flex-1 px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={!inputMessage.trim() || isChatLoading}
                        className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <span>Send</span>
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                    <div className="mt-2 text-[10px] text-zinc-500 text-center">
                      AI answers are informational and do not constitute legal advice.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};
