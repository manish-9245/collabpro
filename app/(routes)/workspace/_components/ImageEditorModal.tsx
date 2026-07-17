import React, { useState, useEffect, useRef } from 'react';
import { 
  X, RotateCw, FlipHorizontal, FlipVertical, 
  Sun, Contrast, Sliders, Sparkles, Undo, Redo, 
  RotateCcw, Check, Crop, RefreshCw, Layers
} from 'lucide-react';
import { toast } from 'sonner';

interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (editedImageUrl: string) => void;
}

interface CropState {
  x: number;      // percent (0-100)
  y: number;      // percent (0-100)
  width: number;  // percent (0-100)
  height: number; // percent (0-100)
}

interface EditState {
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  grayscale: number;
  sepia: number;
  invert: number;
  hueRotate: number;
  crop: CropState;
  activePreset: string;
}

const DEFAULT_EDIT_STATE: EditState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotation: 0,
  flipH: false,
  flipV: false,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  hueRotate: 0,
  crop: { x: 0, y: 0, width: 100, height: 100 },
  activePreset: 'original'
};

const PRESETS = [
  { id: 'original', name: 'Original', filter: 'none' },
  { id: 'grayscale', name: 'Grayscale', filter: 'grayscale(100%)' },
  { id: 'sepia', name: 'Sepia', filter: 'sepia(100%)' },
  { id: 'vintage', name: 'Vintage', filter: 'sepia(40%) contrast(120%) brightness(90%)' },
  { id: 'invert', name: 'Invert', filter: 'invert(100%)' },
  { id: 'warm', name: 'Warm Warmth', filter: 'sepia(30%) saturate(130%)' },
  { id: 'cool', name: 'Cool Ice', filter: 'hue-rotate(200deg) saturate(110%)' },
  { id: 'dramatic', name: 'Dramatic', filter: 'contrast(140%) brightness(85%) saturate(80%)' },
];

export default function ImageEditorModal({ isOpen, onClose, imageUrl, onSave }: ImageEditorModalProps) {
  const [currentState, setCurrentState] = useState<EditState>({ ...DEFAULT_EDIT_STATE });
  const [history, setHistory] = useState<EditState[]>([{ ...DEFAULT_EDIT_STATE }]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  
  const [activeTab, setActiveTab] = useState<'filters' | 'adjust' | 'crop'>('filters');
  const [isSaving, setIsSaving] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Crop UI State
  const [isCropActive, setIsCropActive] = useState(false);
  const [aspectRatioPreset, setAspectRatioPreset] = useState<'free' | '1:1' | '4:3' | '16:9'>('free');
  
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cropOverlayRef = useRef<HTMLDivElement>(null);
  
  // Dragging / Resizing State
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'move' | 'tl' | 'tr' | 'bl' | 'br' | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; crop: CropState }>({ clientX: 0, clientY: 0, crop: { ...DEFAULT_EDIT_STATE.crop } });

  // Update edit state and manage undo/redo history
  const updateState = (newState: EditState | ((prev: EditState) => EditState)) => {
    setCurrentState(prev => {
      const resolved = typeof newState === 'function' ? newState(prev) : newState;
      
      // Update history stack
      const nextHistory = history.slice(0, historyIndex + 1);
      setHistory([...nextHistory, resolved]);
      setHistoryIndex(nextHistory.length);
      
      return resolved;
    });
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setCurrentState({ ...history[prevIndex] });
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setCurrentState({ ...history[nextIndex] });
    }
  };

  const handleReset = () => {
    updateState({ ...DEFAULT_EDIT_STATE });
    setAspectRatioPreset('free');
    setIsCropActive(false);
    toast.success('All edits have been reset to original.');
  };

  // Preset Filters applyer
  const handleApplyPreset = (presetId: string) => {
    let brightness = 100;
    let contrast = 100;
    let saturation = 100;
    let grayscale = 0;
    let sepia = 0;
    let invert = 0;
    let hueRotate = 0;

    switch (presetId) {
      case 'grayscale':
        grayscale = 100;
        break;
      case 'sepia':
        sepia = 100;
        break;
      case 'vintage':
        sepia = 40;
        contrast = 120;
        brightness = 90;
        break;
      case 'invert':
        invert = 100;
        break;
      case 'warm':
        sepia = 30;
        saturation = 130;
        break;
      case 'cool':
        hueRotate = 200;
        saturation = 110;
        break;
      case 'dramatic':
        contrast = 140;
        brightness = 85;
        saturation = 80;
        break;
      default:
        break;
    }

    updateState(prev => ({
      ...prev,
      activePreset: presetId,
      brightness,
      contrast,
      saturation,
      grayscale,
      sepia,
      invert,
      hueRotate
    }));
  };

  // Rotations & Flips
  const handleRotate = () => {
    updateState(prev => ({
      ...prev,
      rotation: (prev.rotation + 90) % 360
    }));
  };

  const handleFlipH = () => {
    updateState(prev => ({
      ...prev,
      flipH: !prev.flipH
    }));
  };

  const handleFlipV = () => {
    updateState(prev => ({
      ...prev,
      flipV: !prev.flipV
    }));
  };

  // Crop Ratio change
  const handleAspectRatioChange = (preset: 'free' | '1:1' | '4:3' | '16:9') => {
    setAspectRatioPreset(preset);
    
    if (preset === 'free') return;
    
    let ratio = 1;
    if (preset === '1:1') ratio = 1;
    else if (preset === '4:3') ratio = 4 / 3;
    else if (preset === '16:9') ratio = 16 / 9;

    updateState(prev => {
      let w = 80;
      let h = 80;
      
      // Attempt to fit requested ratio
      if (ratio > 1) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }

      const x = (100 - w) / 2;
      const y = (100 - h) / 2;

      return {
        ...prev,
        crop: { x, y, width: w, height: h }
      };
    });
  };

  // Crop Region Drag & Resize Logic (Pointer Events)
  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault();
    if (!isCropActive) return;

    setIsDragging(true);
    setDragType(type);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      crop: { ...currentState.crop }
    };
    
    if (cropOverlayRef.current) {
      cropOverlayRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragType || !imageRef.current) return;
    e.preventDefault();

    const imageWidth = imageRef.current.clientWidth;
    const imageHeight = imageRef.current.clientHeight;

    const deltaX = ((e.clientX - dragStartRef.current.clientX) / imageWidth) * 100;
    const deltaY = ((e.clientY - dragStartRef.current.clientY) / imageHeight) * 100;

    const startCrop = dragStartRef.current.crop;

    setCurrentState(prev => {
      let { x, y, width, height } = { ...prev.crop };

      if (dragType === 'move') {
        x = Math.max(0, Math.min(100 - width, startCrop.x + deltaX));
        y = Math.max(0, Math.min(100 - height, startCrop.y + deltaY));
      } else {
        // Compute new coordinates based on handle
        if (dragType === 'tl') {
          const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - 10, startCrop.x + deltaX));
          const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - 10, startCrop.y + deltaY));
          width = startCrop.x + startCrop.width - newX;
          height = startCrop.y + startCrop.height - newY;
          x = newX;
          y = newY;
        } else if (dragType === 'tr') {
          width = Math.max(10, Math.min(100 - startCrop.x, startCrop.width + deltaX));
          const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - 10, startCrop.y + deltaY));
          height = startCrop.y + startCrop.height - newY;
          y = newY;
        } else if (dragType === 'bl') {
          const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - 10, startCrop.x + deltaX));
          width = startCrop.x + startCrop.width - newX;
          height = Math.max(10, Math.min(100 - startCrop.y, startCrop.height + deltaY));
          x = newX;
        } else if (dragType === 'br') {
          width = Math.max(10, Math.min(100 - startCrop.x, startCrop.width + deltaX));
          height = Math.max(10, Math.min(100 - startCrop.y, startCrop.height + deltaY));
        }

        // Apply Aspect Ratio Constraint if enabled
        if (aspectRatioPreset !== 'free') {
          let ratio = 1;
          if (aspectRatioPreset === '1:1') ratio = 1;
          else if (aspectRatioPreset === '4:3') ratio = 4 / 3;
          else if (aspectRatioPreset === '16:9') ratio = 16 / 9;

          // Maintain height relative to width based on container layout ratio
          const containerRatio = imageWidth / imageHeight;
          const desiredHeight = (width / ratio) * containerRatio;

          if (dragType === 'tl' || dragType === 'tr') {
            // Adjust y to match new height
            const heightDiff = desiredHeight - height;
            y = Math.max(0, y - heightDiff);
            height = desiredHeight;
          } else {
            height = desiredHeight;
          }
        }
      }

      // Constrain inside bounds
      if (x + width > 100) width = 100 - x;
      if (y + height > 100) height = 100 - y;

      return {
        ...prev,
        crop: { x, y, width, height }
      };
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragType(null);
    if (cropOverlayRef.current) {
      cropOverlayRef.current.releasePointerCapture(e.pointerId);
    }
    
    // Save state update in history upon finish drag
    setHistory(prev => {
      const nextHistory = prev.slice(0, historyIndex + 1);
      return [...nextHistory, currentState];
    });
    setHistoryIndex(prev => prev + 1);
  };

  // Compile full CSS style string for filter preview
  const getFilterStyle = () => {
    const { brightness, contrast, saturation, grayscale, sepia, invert, hueRotate } = currentState;
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) sepia(${sepia}%) invert(${invert}%) hue-rotate(${hueRotate}deg)`;
  };

  // Reset editor upon closing
  useEffect(() => {
    if (isOpen) {
      setCurrentState({ ...DEFAULT_EDIT_STATE });
      setHistory([{ ...DEFAULT_EDIT_STATE }]);
      setHistoryIndex(0);
      setImageLoaded(false);
      setIsCropActive(false);
      setAspectRatioPreset('free');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Process & Export Edited Image using Canvas Rendering Context Pipeline
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // 1. Create offline canvas with dimensions mapped to original image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not construct 2D context");

      const { rotation, flipH, flipV, crop } = currentState;

      // Determine dimensions after crop
      const cropX = (crop.x / 100) * img.naturalWidth;
      const cropY = (crop.y / 100) * img.naturalHeight;
      const cropW = (crop.width / 100) * img.naturalWidth;
      const cropH = (crop.height / 100) * img.naturalHeight;

      // Swap dimensions if rotated 90 or 270 deg
      const isSwapped = rotation === 90 || rotation === 270;
      canvas.width = isSwapped ? cropH : cropW;
      canvas.height = isSwapped ? cropW : cropH;

      // Apply transformations to canvas origin
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

      // Apply adjust & filters on canvas directly!
      ctx.filter = getFilterStyle();

      // Draw original image portion into center
      ctx.drawImage(
        img,
        cropX, cropY, cropW, cropH, // Source sub-rectangle
        -cropW / 2, -cropH / 2, cropW, cropH // Destination sub-rectangle
      );

      // 2. Export to Blob and upload to API
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Failed to generate edited image blob.");
          setIsSaving(false);
          return;
        }

        const formData = new FormData();
        const extension = img.src.includes('webp') ? 'webp' : 'png';
        formData.append('file', blob, `edited_image_${Date.now()}.${extension}`);

        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });
          const result = await res.json();

          if (result.success && result.file?.url) {
            toast.success("Image edited and saved successfully!");
            onSave(result.file.url);
            onClose();
          } else {
            toast.error(result.message || "Failed to upload edited image.");
          }
        } catch (uploadErr) {
          console.error("Failed to upload edited image:", uploadErr);
          toast.error("Network error saving edited image.");
        } finally {
          setIsSaving(false);
        }
      }, 'image/png');

    } catch (err: any) {
      console.error("Error editing image:", err);
      toast.error(`Error saving image: ${err?.message || 'Unknown error'}`);
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Dark backdrop overlay with slight blur */}
      <div 
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-md transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
      />

      {/* Editor Modal Window (Premium Dark/Glass System Theme) */}
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] max-h-[850px] animate-in zoom-in-95 duration-200 text-slate-100">
        
        {/* Header toolbar */}
        <div className="px-6 py-4.5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white">Creative Image Manipulator</h2>
              <p className="text-[11px] text-slate-400 font-medium">Non-destructive editing filters, crops, rotations, & sliders</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Undo / Redo */}
            <button
              onClick={handleUndo}
              disabled={historyIndex === 0}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-xl text-slate-300 transition-colors"
              title="Undo edit"
            >
              <Undo className="h-4 w-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex === history.length - 1}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-xl text-slate-300 transition-colors"
              title="Redo edit"
            >
              <Redo className="h-4 w-4" />
            </button>

            <div className="w-[1px] h-6 bg-slate-800 mx-1" />

            <button 
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Workspace Body Grid */}
        <div className="flex-1 flex overflow-hidden min-h-0 bg-slate-950/20">
          
          {/* Main live interactive workspace stage (Left) */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative min-w-0 border-r border-slate-800/60 overflow-hidden">
            
            <div 
              ref={containerRef}
              className="relative max-w-full max-h-[500px] flex items-center justify-center select-none"
            >
              {/* Spinning loading spinner */}
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 rounded-2xl">
                  <RefreshCw className="h-8 w-8 text-blue-500 animate-spin" />
                </div>
              )}

              {/* Editable base Image layer with real-time CSS filtering */}
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Edit Preview"
                onLoad={() => setImageLoaded(true)}
                className={`max-w-full max-h-[500px] object-contain rounded-xl transition-transform duration-100 ${!imageLoaded ? 'invisible' : ''}`}
                style={{
                  filter: getFilterStyle(),
                  transform: `rotate(${currentState.rotation}deg) scale(${currentState.flipH ? -1 : 1}, ${currentState.flipV ? -1 : 1})`,
                }}
              />

              {/* Crop visual overlay box (rendered only when Crop tab is active) */}
              {imageLoaded && isCropActive && (
                <div 
                  ref={cropOverlayRef}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="absolute border-2 border-dashed border-blue-500 z-10 rounded shadow-md cursor-grab active:cursor-grabbing"
                  style={{
                    left: `${currentState.crop.x}%`,
                    top: `${currentState.crop.y}%`,
                    width: `${currentState.crop.width}%`,
                    height: `${currentState.crop.height}%`,
                    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.65)' // Dims outer area
                  }}
                  onPointerDown={(e) => handlePointerDown(e, 'move')}
                >
                  {/* Resizing crop corner nodes */}
                  <div 
                    className="absolute -top-1.5 -left-1.5 h-3.5 w-3.5 bg-blue-500 border border-white rounded-full cursor-nwse-resize z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'tl')}
                  />
                  <div 
                    className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 bg-blue-500 border border-white rounded-full cursor-nesw-resize z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'tr')}
                  />
                  <div 
                    className="absolute -bottom-1.5 -left-1.5 h-3.5 w-3.5 bg-blue-500 border border-white rounded-full cursor-nesw-resize z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'bl')}
                  />
                  <div 
                    className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 bg-blue-500 border border-white rounded-full cursor-nwse-resize z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'br')}
                  />
                </div>
              )}
            </div>

            {/* Bottom mini transform shortcuts panel */}
            {imageLoaded && (
              <div className="absolute bottom-4.5 bg-slate-900/90 border border-slate-800/60 backdrop-blur-md py-1.5 px-3 rounded-full flex items-center gap-1 shadow-lg animate-in slide-in-from-bottom-5">
                <button
                  onClick={handleRotate}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-bold"
                  title="Rotate clockwise 90°"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Rotate
                </button>
                <div className="w-[1px] h-4 bg-slate-800 mx-1" />
                <button
                  onClick={handleFlipH}
                  className={`p-2 hover:bg-slate-800 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold ${currentState.flipH ? 'bg-blue-600/35 text-blue-400 hover:bg-blue-600/35' : 'text-slate-300 hover:text-white'}`}
                  title="Flip horizontally"
                >
                  <FlipHorizontal className="h-3.5 w-3.5" />
                  Flip H
                </button>
                <button
                  onClick={handleFlipV}
                  className={`p-2 hover:bg-slate-800 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold ${currentState.flipV ? 'bg-blue-600/35 text-blue-400 hover:bg-blue-600/35' : 'text-slate-300 hover:text-white'}`}
                  title="Flip vertically"
                >
                  <FlipVertical className="h-3.5 w-3.5" />
                  Flip V
                </button>
              </div>
            )}
          </div>

          {/* Right sidebar controls panel (Filters, sliders, crop presets) */}
          <div className="w-80 flex flex-col h-full bg-slate-900/60 overflow-hidden">
            
            {/* Sidebar Tabs */}
            <div className="flex border-b border-slate-800/80 p-1.5 bg-slate-950/20">
              <button
                onClick={() => {
                  setActiveTab('filters');
                  setIsCropActive(false);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'filters' ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Filters
              </button>
              <button
                onClick={() => {
                  setActiveTab('adjust');
                  setIsCropActive(false);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'adjust' ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Sliders className="h-3.5 w-3.5" />
                Adjust
              </button>
              <button
                onClick={() => {
                  setActiveTab('crop');
                  setIsCropActive(true);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'crop' ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Crop className="h-3.5 w-3.5" />
                Crop
              </button>
            </div>

            {/* Panel Tab Content scroll area */}
            <div className="flex-1 overflow-y-auto p-5.5 space-y-6">
              
              {/* 1. FILTER PRESETS */}
              {activeTab === 'filters' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <Layers className="h-3.5 w-3.5" />
                    <span>Aesthetic Style Presets</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {PRESETS.map((preset) => {
                      const isActive = currentState.activePreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => handleApplyPreset(preset.id)}
                          className={`group flex flex-col items-center p-3 rounded-2xl border transition-all text-center relative overflow-hidden ${isActive ? 'border-blue-500 bg-blue-600/10 text-white shadow-md' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-850/50 hover:border-slate-700 text-slate-300'}`}
                        >
                          <div 
                            className="h-10 w-full rounded-lg bg-slate-800 mb-2 border border-slate-700 flex items-center justify-center text-[10px] font-extrabold text-slate-500 overflow-hidden relative"
                          >
                            {/* Tiny thumbnail simulation */}
                            <div 
                              className="absolute inset-0 bg-gradient-to-tr from-orange-400 to-indigo-500"
                              style={{ filter: preset.filter }}
                            />
                            <span className="relative z-10 drop-shadow-md text-white">Preview</span>
                          </div>
                          <span className="text-[11px] font-bold group-hover:scale-105 transition-transform">{preset.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. SLIDERS/ADJUSTMENTS */}
              {activeTab === 'adjust' && (
                <div className="space-y-5.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <Sliders className="h-3.5 w-3.5" />
                    <span>Color Tone Tuning</span>
                  </div>

                  {/* Brightness */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <Sun className="h-3.5 w-3.5 text-orange-400" />
                        <span>Brightness</span>
                      </div>
                      <span className="font-mono">{currentState.brightness}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      value={currentState.brightness}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCurrentState(prev => ({ ...prev, brightness: val, activePreset: 'custom' }));
                      }}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  {/* Contrast */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <Contrast className="h-3.5 w-3.5 text-purple-400" />
                        <span>Contrast</span>
                      </div>
                      <span className="font-mono">{currentState.contrast}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      value={currentState.contrast}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCurrentState(prev => ({ ...prev, contrast: val, activePreset: 'custom' }));
                      }}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  {/* Saturation */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Saturation</span>
                      </div>
                      <span className="font-mono">{currentState.saturation}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      value={currentState.saturation}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCurrentState(prev => ({ ...prev, saturation: val, activePreset: 'custom' }));
                      }}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* 3. CROP CAPABILITIES */}
              {activeTab === 'crop' && (
                <div className="space-y-5.5 animate-in fade-in">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <Crop className="h-3.5 w-3.5" />
                    <span>Crop Aspect Ratio Preset</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { id: 'free', name: 'Free-form' },
                      { id: '1:1', name: 'Square 1:1' },
                      { id: '4:3', name: 'Standard 4:3' },
                      { id: '16:9', name: 'Widescreen 16:9' }
                    ].map((preset) => {
                      const isActive = aspectRatioPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleAspectRatioChange(preset.id as any)}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${isActive ? 'border-blue-500 bg-blue-600/10 text-white shadow-inner' : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200'}`}
                        >
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
                    <p className="text-[10px] leading-relaxed text-slate-400 font-medium">
                      Drag the corner handles in the viewer to crop. Choose ratio presets above to clamp bounding bounds automatically.
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Footer actions bar */}
        <div className="px-6 py-4.5 border-t border-slate-800/80 flex items-center justify-between bg-slate-950/30">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-850 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-all shadow-sm"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset all
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4.5 py-2 border border-slate-800 bg-transparent hover:bg-slate-850 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-xl text-xs font-extrabold text-white transition-all shadow-md shadow-blue-900/20"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Apply & Save
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
