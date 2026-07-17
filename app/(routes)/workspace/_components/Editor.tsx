"use client"
import React, { useEffect, useRef, useState } from 'react'
import EditorJS from '@editorjs/editorjs';
// @ts-ignore
import Header from '@editorjs/header';
// @ts-ignore
import List from "@editorjs/list";
// @ts-ignore
import Checklist from '@editorjs/checklist'
// @ts-ignore
import Paragraph from '@editorjs/paragraph';
// @ts-ignore
import Warning from '@editorjs/warning';
// @ts-ignore
import ImageTool from '@editorjs/image';
import { api, useMutation } from '@/lib/state-sync/react';
import { toast } from 'sonner';
import { FILE } from '../../dashboard/_components/FileList';
import { encodeCrdtState, decodeCrdtState } from '@/lib/crdt';
import { Sparkles } from 'lucide-react';
import ImageEditorModal from './ImageEditorModal';

const rawDocument={
    "time" : 1550476186479,
    "blocks" : [{
        data:{
            text:'Document Name',
            level:2
        },
        id:"123",
        type:'header'
    },
    {
        data:{
            level:4
        },
        id:"1234",
        type:'header'
    }],
    "version" : "2.8.1"
}
interface EditorProps {
    onSaveTrigger: any;
    fileId: any;
    fileData: FILE;
    setSavingStatus: (status: 'idle' | 'saving' | 'saved') => void;
    undoTrigger: number;
    redoTrigger: number;
    onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
    activePanel: 'document' | 'canvas';
}

function Editor({
    onSaveTrigger,
    fileId,
    fileData,
    setSavingStatus,
    undoTrigger,
    redoTrigger,
    onHistoryChange,
    activePanel
}: EditorProps) {
    const ref=useRef<EditorJS | null>(null);
    const updateDocument=useMutation(api.files.updateDocument);
    const saveTimeoutRef=useRef<NodeJS.Timeout|null>(null);
    const lastSavedDataRef=useRef<string>("");
    const isProgrammaticUpdateRef=useRef<boolean>(false);

    // Undo/Redo History Stack (client-side)
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef<number>(-1);

    // Keep track of trigger changes to avoid firing on initial mount
    const lastUndoTriggerRef = useRef(0);
    const lastRedoTriggerRef = useRef(0);

    const [hoveredImageBlock, setHoveredImageBlock] = useState<{ id: string; url: string; element: HTMLElement } | null>(null);
    const [activeEditingImageBlock, setActiveEditingImageBlock] = useState<{ id: string; url: string } | null>(null);

    // New state for smooth lossless display resizer
    const [selectedImageBlock, setSelectedImageBlock] = useState<{ id: string; url: string; element: HTMLElement; width: string } | null>(null);
    const [overlayRect, setOverlayRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; widthPx: number; parentWidth: number; centerX: number } | null>(null);

    // Scan EditorJS blocks and apply stored image widths to the DOM elements
    const applyImageWidths = () => {
        if (!ref.current) return;
        try {
            const count = ref.current.blocks.getBlocksCount();
            for (let i = 0; i < count; i++) {
                const block = ref.current.blocks.getBlockByIndex(i);
                if (block && block.name === 'image') {
                    const blockId = block.id;
                    const savedWidth = (block as any).data?.width;
                    if (savedWidth) {
                        const ceBlock = document.querySelector(`.ce-block[data-id="${blockId}"]`);
                        if (ceBlock) {
                            const imageWrapper = ceBlock.querySelector('.image-tool__image') as HTMLElement;
                            if (imageWrapper) {
                                imageWrapper.style.width = savedWidth;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error applying image widths:", err);
        }
    };

    // Calculate pixel-perfect overlay coordinates relative to our editor stage wrapper
    const updateOverlayRect = () => {
        if (!selectedImageBlock) return;
        const imgEl = selectedImageBlock.element;
        const editorContainer = document.getElementById('editorjs');
        if (!imgEl || !editorContainer) return;

        const imgRect = imgEl.getBoundingClientRect();
        const containerRect = editorContainer.getBoundingClientRect();

        setOverlayRect({
            top: imgRect.top - containerRect.top + editorContainer.offsetTop,
            left: imgRect.left - containerRect.left + editorContainer.offsetLeft,
            width: imgRect.width,
            height: imgRect.height
        });
    };

    // Watch for image hover, selection, and Esc dismissals
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!ref.current) return;
            const target = e.target as HTMLElement;
            
            const ceBlock = target.closest('.ce-block');
            if (!ceBlock) {
                setHoveredImageBlock(null);
                return;
            }
            
            const img = ceBlock.querySelector('img');
            const blockId = ceBlock.getAttribute('data-id');
            
            if (img && img.src && blockId) {
                setHoveredImageBlock({
                    id: blockId,
                    url: img.src,
                    element: ceBlock as HTMLElement
                });
            } else {
                setHoveredImageBlock(null);
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (!ref.current) return;
            const target = e.target as HTMLElement;
            
            const ceBlock = target.closest('.ce-block');
            if (!ceBlock) {
                // Clicking outside, let's keep selected only if it is one of our own interactive overlay controls
                if (!target.closest('.pointer-events-auto')) {
                    setSelectedImageBlock(null);
                }
                return;
            }
            
            const img = ceBlock.querySelector('img');
            const blockId = ceBlock.getAttribute('data-id');
            const imageWrapper = ceBlock.querySelector('.image-tool__image') as HTMLElement;
            
            const editorInstance = ref.current as any;
            if (editorInstance && img && img.src && blockId && imageWrapper) {
                editorInstance.blocks.getById(blockId).then((block: any) => {
                    const savedWidth = (block as any)?.data?.width || '100%';
                    setSelectedImageBlock({
                        id: blockId,
                        url: img.src,
                        element: imageWrapper,
                        width: savedWidth
                    });
                }).catch(() => {
                    setSelectedImageBlock({
                        id: blockId,
                        url: img.src,
                        element: imageWrapper,
                        width: imageWrapper.style.width || '100%'
                    });
                });
            } else {
                if (!target.closest('.pointer-events-auto')) {
                    setSelectedImageBlock(null);
                }
            }
        };

        const container = document.getElementById('editorjs');
        if (container) {
            container.addEventListener('mousemove', handleMouseMove);
            container.addEventListener('mousedown', handleMouseDown);
        }
        return () => {
            if (container) {
                container.removeEventListener('mousemove', handleMouseMove);
                container.removeEventListener('mousedown', handleMouseDown);
            }
        };
    }, []);

    // Watch escape key to clear selection
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setSelectedImageBlock(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Update overlay position on scroll or resize events
    useEffect(() => {
        if (!selectedImageBlock) {
            setOverlayRect(null);
            return;
        }

        updateOverlayRect();

        window.addEventListener('resize', updateOverlayRect);
        window.addEventListener('scroll', updateOverlayRect, true);

        return () => {
            window.removeEventListener('resize', updateOverlayRect);
            window.removeEventListener('scroll', updateOverlayRect, true);
        };
    }, [selectedImageBlock]);

    // Apply widths regularly during page updates/changes
    useEffect(() => {
        applyImageWidths();
        const interval = setInterval(() => {
            applyImageWidths();
        }, 1000);
        return () => clearInterval(interval);
    }, [fileData?.document]);

    // Handle horizontal or diagonal drag resizing
    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedImageBlock) return;

        const imgEl = selectedImageBlock.element;
        const rect = imgEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        
        const ceBlock = imgEl.closest('.ce-block');
        const parentWidth = ceBlock ? ceBlock.clientWidth : imgEl.parentElement?.clientWidth || 800;

        setIsResizing(true);
        setDragStart({
            x: e.clientX,
            widthPx: rect.width,
            parentWidth,
            centerX
        });
    };

    useEffect(() => {
        if (!isResizing || !dragStart || !selectedImageBlock) return;

        const handleMouseMove = (e: MouseEvent) => {
            const imgEl = selectedImageBlock.element;
            const currentX = e.clientX;
            const newHalfWidth = Math.abs(currentX - dragStart.centerX);
            const newWidthPx = 2 * newHalfWidth;

            const minWidth = 120;
            const maxWidth = dragStart.parentWidth;
            const boundedWidth = Math.max(minWidth, Math.min(maxWidth, newWidthPx));

            const pct = (boundedWidth / dragStart.parentWidth) * 100;
            const widthStr = `${pct.toFixed(1)}%`;

            imgEl.style.transition = 'none';
            imgEl.style.width = widthStr;

            updateOverlayRect();
        };

        const handleMouseUp = async (e: MouseEvent) => {
            setIsResizing(false);
            const imgEl = selectedImageBlock.element;
            imgEl.style.transition = '';

            const currentX = e.clientX;
            const newHalfWidth = Math.abs(currentX - dragStart.centerX);
            const newWidthPx = 2 * newHalfWidth;
            const boundedWidth = Math.max(120, Math.min(dragStart.parentWidth, newWidthPx));
            const pct = (boundedWidth / dragStart.parentWidth) * 100;
            const finalWidthStr = `${pct.toFixed(1)}%`;

            setSelectedImageBlock(prev => {
                if (!prev) return null;
                return { ...prev, width: finalWidthStr };
            });

            if (ref.current) {
                try {
                    const blockId = selectedImageBlock.id;
                    const block = await ref.current.blocks.getById(blockId);
                    if (block) {
                        const updatedData = {
                            ...(block as any).data,
                            width: finalWidthStr
                        };
                        await ref.current.blocks.update(blockId, updatedData);
                        
                        setTimeout(() => {
                            applyImageWidths();
                            updateOverlayRect();
                        }, 50);
                    }
                } catch (err) {
                    console.error("Error saving resized width to EditorJS block:", err);
                }
            }
            setDragStart(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, dragStart, selectedImageBlock]);

    // Handle instant-apply layout percentage presets
    const handleApplyPresetWidth = async (pct: number) => {
        if (!selectedImageBlock || !ref.current) return;

        const widthStr = `${pct}%`;
        const blockId = selectedImageBlock.id;

        const imgEl = selectedImageBlock.element;
        imgEl.style.transition = 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        imgEl.style.width = widthStr;

        setSelectedImageBlock(prev => {
            if (!prev) return null;
            return { ...prev, width: widthStr };
        });

        try {
            const block = await ref.current.blocks.getById(blockId);
            if (block) {
                const updatedData = {
                    ...(block as any).data,
                    width: widthStr
                };
                await ref.current.blocks.update(blockId, updatedData);
                
                setTimeout(() => {
                    applyImageWidths();
                    updateOverlayRect();
                }, 100);
            }
        } catch (err) {
            console.error("Error saving preset width to EditorJS:", err);
        }
    };

    // Initialize Editor on mount
    useEffect(()=>{
        if (fileData && !ref.current) {
            initEditor();
        }
    },[fileData])

    // Save triggers from manual header clicks or other manual actions
    useEffect(()=>{
      onSaveTrigger&&onSaveDocument(true);
    },[onSaveTrigger])

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        }
    }, []);

    // Listen to real-time sync updates from database polling
    useEffect(() => {
        if (!ref.current || !fileData?.document) return;
        
        try {
            // Check if server's CRDT update string matches what we last saved
            if (fileData.document === lastSavedDataRef.current) {
                return;
            }
            
            const serverDoc = decodeCrdtState(fileData.document, rawDocument);
            
            // Only overwrite if we are not currently typing or waiting on a debounced save
            if (saveTimeoutRef.current === null && !saveTimeoutRef.current) {
                isProgrammaticUpdateRef.current = true;
                ref.current.render(serverDoc).then(() => {
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
                        applyImageWidths();
                    }, 100);
                }).catch(() => {
                    isProgrammaticUpdateRef.current = false;
                });
                lastSavedDataRef.current = fileData.document;
                
                // Initialize/reset history stack to match this new server state
                historyRef.current = [fileData.document];
                historyIndexRef.current = 0;
                if (onHistoryChange && activePanel === 'document') {
                    onHistoryChange(false, false);
                }
            }
        } catch (e) {
            console.error("Error updating editor from realtime sync:", e);
        }
    }, [fileData?.document]);

    // Handle incoming Undo Trigger from Header toolbar
    useEffect(() => {
        if (activePanel !== 'document') return;
        if (undoTrigger > lastUndoTriggerRef.current) {
            lastUndoTriggerRef.current = undoTrigger;
            performUndo();
        }
    }, [undoTrigger, activePanel]);

    // Handle incoming Redo Trigger from Header toolbar
    useEffect(() => {
        if (activePanel !== 'document') return;
        if (redoTrigger > lastRedoTriggerRef.current) {
            lastRedoTriggerRef.current = redoTrigger;
            performRedo();
        }
    }, [redoTrigger, activePanel]);

    // Keyboard Shortcuts for Undo (Cmd+Z / Ctrl+Z) and Redo (Cmd+Y / Ctrl+Y / Cmd+Shift+Z)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only capture shortcuts when focusing the Editor's container
            if (!document.activeElement?.closest('#editorjs')) return;
            
            const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const isUndo = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
            const isRedo = (isMac ? e.metaKey : e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));
            
            if (isUndo) {
                e.preventDefault();
                performUndo();
            } else if (isRedo) {
                e.preventDefault();
                performRedo();
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activePanel]);

    const performUndo = () => {
        if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
            const prevStateStr = historyRef.current[historyIndexRef.current];
            const prevState = JSON.parse(prevStateStr);
            
            if (ref.current) {
                isProgrammaticUpdateRef.current = true;
                ref.current.render(prevState).then(() => {
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
                        applyImageWidths();
                    }, 100);
                }).catch(() => {
                    isProgrammaticUpdateRef.current = false;
                });
                lastSavedDataRef.current = encodeCrdtState(prevState);
                if (onHistoryChange) {
                    onHistoryChange(historyIndexRef.current > 0, true);
                }
                
                // Immediately save the undone state to the DB (non-debounced for explicit action)
                saveHistoryStateToDb(prevStateStr);
            }
        }
    };

    const performRedo = () => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current++;
            const nextStateStr = historyRef.current[historyIndexRef.current];
            const nextState = JSON.parse(nextStateStr);
            
            if (ref.current) {
                isProgrammaticUpdateRef.current = true;
                ref.current.render(nextState).then(() => {
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
                        applyImageWidths();
                    }, 100);
                }).catch(() => {
                    isProgrammaticUpdateRef.current = false;
                });
                lastSavedDataRef.current = encodeCrdtState(nextState);
                if (onHistoryChange) {
                    onHistoryChange(true, historyIndexRef.current < historyRef.current.length - 1);
                }
                
                // Immediately save the redone state to the DB
                saveHistoryStateToDb(nextStateStr);
            }
        }
    };

    const saveHistoryStateToDb = (stateStr: string) => {
        setSavingStatus('saving');
        const crdtStr = encodeCrdtState(JSON.parse(stateStr));
        lastSavedDataRef.current = crdtStr;
        updateDocument({
            _id: fileId,
            document: crdtStr
        }).then(() => {
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 1000);
        }).catch(() => {
            setSavingStatus('idle');
        });
    };

    const initEditor=()=>{
        const decodedDoc = fileData?.document ? decodeCrdtState(fileData.document, rawDocument) : rawDocument;
        const initialDocStr = JSON.stringify(decodedDoc);
        
        lastSavedDataRef.current = fileData?.document || encodeCrdtState(decodedDoc);
        
        // Setup initial history
        historyRef.current = [initialDocStr];
        historyIndexRef.current = 0;
        if (onHistoryChange && activePanel === 'document') {
            onHistoryChange(false, false);
        }

        const editor = new EditorJS({
            tools:{
                header: {
                    class: Header,
                    shortcut: 'CMD+SHIFT+H',
                    config:{
                        placeholder:'Enter a Header'
                    }
                  },
                  list: {
                    class: List,
                    inlineToolbar: true,
                    config: {
                      defaultStyle: 'unordered'
                    }
                  },
                  checklist: {
                    class: Checklist,
                    inlineToolbar: true,
                  },
                  paragraph: Paragraph,
                  warning: Warning,
                  image: {
                    class: ImageTool as any,
                    config: {
                      endpoints: {
                        byFile: '/api/upload',
                        byUrl: '/api/upload',
                      }
                    }
                  },
            },
           
            holder: 'editorjs',
            data: decodedDoc,
            onReady: () => {
                applyImageWidths();
            },
            onChange: () => {
                if (isProgrammaticUpdateRef.current) {
                    return;
                }
                setSavingStatus('saving');
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    onSaveDocument(false);
                    saveTimeoutRef.current = null;
                }, 1500);

                setTimeout(() => {
                    applyImageWidths();
                }, 100);
            }
          });
          ref.current=editor;
    }

    const onSaveDocument=(showToast = false)=>{
      if(ref.current)
      {
        setSavingStatus('saving');
        ref.current.save().then((outputData) => {
          const rawDocStr = JSON.stringify(outputData);
          const crdtStr = encodeCrdtState(outputData);
          lastSavedDataRef.current = crdtStr;

          // Maintain the undo/redo history stack (stores raw standard JSON string)
          if (historyIndexRef.current < historyRef.current.length - 1) {
              // Truncate any forward history if editing from an undone state
              historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
          }
          
          if (historyRef.current[historyIndexRef.current] !== rawDocStr) {
              historyRef.current.push(rawDocStr);
              // Max stack of 50
              if (historyRef.current.length > 50) historyRef.current.shift();
              historyIndexRef.current = historyRef.current.length - 1;
              if (onHistoryChange && activePanel === 'document') {
                  onHistoryChange(historyIndexRef.current > 0, false);
              }
          }

          updateDocument({
            _id:fileId,
            document:crdtStr
          }).then(resp=>{
              setSavingStatus('saved');
              setTimeout(() => setSavingStatus('idle'), 2000);
              if (showToast) {
                toast('Document Updated!')
              }
          },(e)=>{
            setSavingStatus('idle');
            toast("Server Error!")
          })
        }).catch((error) => {
          setSavingStatus('idle');
          console.log('Saving failed: ', error)
        });
      }
    }
    const handleSaveEditedDocumentImage = (editedImageUrl: string) => {
        if (!ref.current || !activeEditingImageBlock) return;
        
        ref.current.save().then((outputData) => {
            const updatedBlocks = outputData.blocks.map((block: any) => {
                if (block.id === activeEditingImageBlock.id && block.type === 'image') {
                    return {
                        ...block,
                        data: {
                            ...block.data,
                            file: {
                                ...block.data?.file,
                                url: editedImageUrl
                            }
                        }
                    };
                }
                return block;
            });
            
            const newOutputData = {
                ...outputData,
                blocks: updatedBlocks
            };
            
            isProgrammaticUpdateRef.current = true;
            ref.current?.render(newOutputData).then(() => {
                const crdtStr = encodeCrdtState(newOutputData);
                lastSavedDataRef.current = crdtStr;
                
                updateDocument({
                    _id: fileId,
                    document: crdtStr
                }).then(() => {
                    toast.success("Image successfully edited and document updated! 🎨");
                    setActiveEditingImageBlock(null);
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
                    }, 100);
                }).catch((err) => {
                    console.error("Failed to save edited document to database:", err);
                    isProgrammaticUpdateRef.current = false;
                });
            });
        }).catch((err) => {
            console.error("Failed saving document state before image edit:", err);
        });
    };

    return (
        <div className="relative group">
            <div id='editorjs' className='ml-20'></div>
            
            {/* Floating Creative Edit Button */}
            {hoveredImageBlock && (
                <button
                    onClick={() => setActiveEditingImageBlock({ id: hoveredImageBlock.id, url: hoveredImageBlock.url })}
                    style={{
                        position: 'absolute',
                        top: hoveredImageBlock.element.offsetTop + 12,
                        left: hoveredImageBlock.element.offsetLeft + hoveredImageBlock.element.offsetWidth - 160,
                        zIndex: 40
                    }}
                    className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-xs px-3 py-2 rounded-lg shadow-lg hover:from-violet-500 hover:to-indigo-500 transition-all duration-200 transform hover:scale-105 active:scale-95"
                >
                    <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                    <span>Creative Edit 🎨</span>
                </button>
            )}

            {/* Smooth Lossless Image Resizer Overlay */}
            {selectedImageBlock && overlayRect && (
                <div
                    style={{
                        position: 'absolute',
                        top: overlayRect.top,
                        left: overlayRect.left,
                        width: overlayRect.width,
                        height: overlayRect.height,
                        zIndex: 30,
                    }}
                    className="pointer-events-none group/resize"
                >
                    {/* Glowing Selection Border */}
                    <div className="absolute inset-0 border-2 border-dashed border-violet-500/85 rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.3)] animate-pulse pointer-events-none" />

                    {/* Width Badge (floating above) */}
                    <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-slate-950/95 border border-slate-800 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1.5 backdrop-blur-md pointer-events-auto select-none">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                        <span>Lossless Display Width:</span>
                        <span className="text-violet-400 font-mono">{selectedImageBlock.width || '100%'}</span>
                    </div>

                    {/* Quick Presets Toolbar (floating below) */}
                    <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 bg-slate-950/95 border border-slate-800 p-1.5 rounded-xl shadow-xl flex items-center gap-1.5 backdrop-blur-md pointer-events-auto scale-95 hover:scale-100 transition-all duration-200 select-none">
                        {[25, 50, 75, 100].map((pct) => (
                            <button
                                key={pct}
                                onClick={() => handleApplyPresetWidth(pct)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition-all duration-150 ${
                                    selectedImageBlock.width === `${pct}%`
                                        ? 'bg-violet-600 text-white shadow-inner'
                                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                                }`}
                            >
                                {pct}%
                            </button>
                        ))}
                        <div className="w-[1px] h-3.5 bg-slate-800 mx-0.5" />
                        <button
                            onClick={() => handleApplyPresetWidth(100)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-violet-400 hover:text-violet-300 hover:bg-slate-900 transition-all duration-150"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Right Edge Handle (Smooth Horizontal Drag) */}
                    <div
                        onMouseDown={handleResizeStart}
                        className="absolute -right-2 top-1/2 transform -translate-y-1/2 w-4 h-12 bg-slate-950 border border-slate-800 hover:border-violet-500 hover:bg-violet-600 rounded-full shadow-md flex items-center justify-center cursor-ew-resize pointer-events-auto transition-all duration-205 hover:scale-110 active:scale-95 group/handle"
                        title="Drag horizontally to resize losslessly"
                    >
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                            <span className="w-0.5 h-3 bg-slate-400 group-hover/handle:bg-white rounded-full" />
                        </div>
                    </div>

                    {/* Bottom-Right Corner Handle (Diagonal Drag) */}
                    <div
                        onMouseDown={handleResizeStart}
                        className="absolute -right-2 -bottom-2 w-5 h-5 bg-slate-950 border border-slate-800 hover:border-violet-500 hover:bg-violet-600 rounded-full shadow-md flex items-center justify-center cursor-nwse-resize pointer-events-auto transition-all duration-205 hover:scale-110 active:scale-95 group/corner"
                        title="Drag diagonally to resize losslessly"
                    >
                        <div className="w-1.5 h-1.5 border-r-2 border-b-2 border-slate-400 group-hover/corner:border-white transform -translate-x-[1px] -translate-y-[1px] pointer-events-none" />
                    </div>
                </div>
            )}

            {/* Image Editor Modal */}
            {activeEditingImageBlock && (
                <ImageEditorModal
                    isOpen={true}
                    onClose={() => setActiveEditingImageBlock(null)}
                    imageUrl={activeEditingImageBlock.url}
                    onSave={handleSaveEditedDocumentImage}
                />
            )}
        </div>
    );
}

export default Editor