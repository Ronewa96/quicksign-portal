import React, { useRef, useState, useEffect } from 'react';
import { useOptionalDocuments } from '../../context/DocumentContext';
import { Pen, Type, Upload, RotateCcw, Check, X } from 'lucide-react';
import {
  Point,
  TypedFont,
  SIGNATURE_COLORS,
  loadSignatureColor,
  saveSignatureColor,
  strokesToSignatureSvg,
  typedSignatureSvg,
} from '../../lib/signatureSvg';

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => void;
  initialSignerName?: string;
}

// System fonts only: SVG images cannot load the page's web fonts
const TYPED_FONTS: Array<{ name: string; style: string; font: TypedFont }> = [
  {
    name: 'Classic Script',
    style: 'italic font-serif tracking-wide text-2xl',
    font: { family: 'Georgia, serif', size: 28, style: 'italic', weight: 400 },
  },
  {
    name: 'Typewriter',
    style: 'font-mono italic text-2xl tracking-tight',
    font: { family: '"Courier New", monospace', size: 26, style: 'italic', weight: 400 },
  },
  {
    name: 'Simple Capitals',
    style: 'font-sans font-light tracking-widest text-2xl uppercase',
    font: { family: '"Segoe UI", Helvetica, Arial, sans-serif', size: 24, style: 'normal', weight: 300, uppercase: true },
  },
  {
    name: 'Bold Script',
    style: 'font-serif text-3xl italic font-bold',
    font: { family: '"Times New Roman", serif', size: 30, style: 'italic', weight: 700 },
  },
];

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSignerName,
}) => {
  // Outside the signed-in app (public signing links) there is no profile to save a default signature to
  const documents = useOptionalDocuments();
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [signerName, setSignerName] = useState(initialSignerName || documents?.userProfile.name || '');
  const [selectedFontIndex, setSelectedFontIndex] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [inkColor, setInkColor] = useState(loadSignatureColor);

  // Canvas ref for drawing
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // Every stroke's points, kept so the signature can be saved as a sharp vector image
  const strokesRef = useRef<Point[][]>([]);

  useEffect(() => {
    if (initialSignerName) setSignerName(initialSignerName);
  }, [initialSignerName]);

  // Reset or initialize canvas when modal opens or tab changes
  useEffect(() => {
    if (!isOpen || tab !== 'draw') return;

    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle high-DPI displays
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = 2.5;

      // Resizing the canvas cleared it, so start a fresh signature
      strokesRef.current = [];
      setHasDrawn(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, tab]);

  // Changing the colour repaints what is already drawn, so nothing has to be redone
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.strokeStyle = inkColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) {
      ctx.beginPath();
      stroke.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  }, [inkColor]);

  if (!isOpen) return null;

  // Drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDrawing(true);
    setHasDrawn(true);
    lastPointRef.current = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
    strokesRef.current.push([lastPointRef.current]);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPointRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    lastPointRef.current = { x: currentX, y: currentY };
    strokesRef.current[strokesRef.current.length - 1]?.push(lastPointRef.current);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    setHasDrawn(false);
  };

  // Upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleApply = () => {
    let finalDataUrl = '';

    if (tab === 'draw') {
      if (!hasDrawn) return;
      finalDataUrl = strokesToSignatureSvg(strokesRef.current, inkColor) || '';
      if (!finalDataUrl) return;
    } else if (tab === 'type') {
      finalDataUrl = typedSignatureSvg(signerName || 'Signature', TYPED_FONTS[selectedFontIndex].font, inkColor);
    } else if (tab === 'upload') {
      if (!uploadedImage) return;
      finalDataUrl = uploadedImage;
    }

    saveSignatureColor(inkColor);

    if (documents && saveAsDefault && finalDataUrl) {
      documents.saveSignatureToProfile(finalDataUrl);
    }

    onSave(finalDataUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden flex flex-col text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white font-display">
              Create Your Signature
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Draw, type, or upload your signature.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex items-center gap-1 p-2 bg-zinc-950/60 border-b border-zinc-800">
          <button
            onClick={() => setTab('draw')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
              tab === 'draw' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Pen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Draw</span>
          </button>

          <button
            onClick={() => setTab('type')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
              tab === 'type' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Type className="w-3.5 h-3.5 text-cyan-400" />
            <span>Type</span>
          </button>

          <button
            onClick={() => setTab('upload')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
              tab === 'upload' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Upload Image</span>
          </button>
        </div>

        {/* Body content based on tab */}
        <div className="p-5 flex-1">
          {tab === 'draw' && (
            <div className="space-y-3">
              {/* Always white, like the paper it will be signed on, so the ink colour shows truly in both themes */}
              <div className="paper relative w-full h-44 bg-white border border-zinc-300 rounded-md overflow-hidden cursor-crosshair">
                <canvas
                  ref={canvasRef}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-full touch-none"
                />
                {!hasDrawn && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-zinc-500">
                    Sign using mouse, stylus, or trackpad
                  </div>
                )}
                {/* Subtle baseline */}
                <div className="absolute bottom-8 left-8 right-8 border-b border-dashed border-zinc-300 pointer-events-none"></div>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono text-[11px] text-zinc-500">
                  Draw your signature inside the box
                </span>
                <button
                  onClick={clearCanvas}
                  className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Pad</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Signer Full Name</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Enter full legal name"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-white focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">Choose a Style</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {TYPED_FONTS.map((font, idx) => {
                    const isSelected = selectedFontIndex === idx;
                    return (
                      <button
                        key={font.name}
                        onClick={() => setSelectedFontIndex(idx)}
                        className={`p-3 rounded-md border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                            : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div className="text-[10px] text-zinc-500 font-mono mb-1">{font.name}</div>
                        <div className={`paper truncate bg-white rounded px-2 py-1 ${font.style}`} style={{ color: inkColor }}>
                          {signerName || 'Signature'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <label className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/50 rounded-md p-6 flex flex-col items-center justify-center cursor-pointer transition-colors text-center">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Upload className="w-6 h-6 text-zinc-500 mb-2" />
                <span className="text-xs font-medium text-zinc-200">
                  {uploadedImage ? 'Click to replace signature file' : 'Click to browse PNG, JPG or SVG signature'}
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">
                  A PNG with a transparent background looks best
                </span>
              </label>

              {uploadedImage && (
                <div className="paper p-4 bg-white border border-zinc-300 rounded-md flex items-center justify-center h-24">
                  <img
                    src={uploadedImage}
                    alt="Uploaded signature preview"
                    className="max-h-20 object-contain"
                  />
                </div>
              )}
            </div>
          )}

          {/* Ink colour */}
          {tab === 'upload' ? (
            <p className="mt-4 text-[11px] text-zinc-500">An uploaded image keeps its own colour.</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Signature colour">
              <span className="text-xs font-medium text-zinc-400 mr-1">Colour</span>
              {SIGNATURE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={inkColor === c.value}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => setInkColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-7 h-7 rounded-full border-2 cursor-pointer flex items-center justify-center ${
                    inkColor === c.value ? 'border-cyan-400' : 'border-zinc-700'
                  }`}
                >
                  {inkColor === c.value && <Check className="w-3.5 h-3.5 text-[#ffffff]" />}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer ml-1">
                <input
                  type="color"
                  value={inkColor}
                  onChange={(e) => setInkColor(e.target.value)}
                  aria-label="Custom signature colour"
                  className="w-7 h-7 p-0 bg-transparent border border-zinc-700 rounded cursor-pointer"
                />
                <span>Custom</span>
              </label>
            </div>
          )}

          {/* Profile Save Option (signed-in users only) */}
          <div className={`mt-4 pt-3 border-t border-zinc-800/80 items-center gap-2 ${documents ? 'flex' : 'hidden'}`}>
            <input
              type="checkbox"
              id="saveDefault"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="rounded bg-zinc-950 border-zinc-700 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <label htmlFor="saveDefault" className="text-xs text-zinc-400 cursor-pointer select-none">
              Save as my signature for next time
            </label>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-zinc-950 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleApply}
            disabled={
              (tab === 'draw' && !hasDrawn) ||
              (tab === 'type' && !signerName.trim()) ||
              (tab === 'upload' && !uploadedImage)
            }
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-all cursor-pointer shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Use This Signature</span>
          </button>
        </div>
      </div>
    </div>
  );
};
