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
            text: '',
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

    // Resizable images state variables
    const [selectedImage, setSelectedImage] = useState<{ id: string; element: HTMLElement; img: HTMLImageElement; width: string } | null>(null);
    const [overlayPos, setOverlayPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const [isDraggingResize, setIsDraggingResize] = useState(false);

    const dragStartWidthRef = useRef<number>(0);
    const dragStartXRef = useRef<number>(0);
    const dragDirectionRef = useRef<'left' | 'right'>('right');

    const applyImageWidths = () => {
        if (!ref.current) return;
        ref.current.save().then((outputData) => {
            outputData.blocks.forEach((block: any) => {
                if (block.type === 'image' && block.data?.width) {
                    const blockEl = document.querySelector(`[data-id="${block.id}"]`);
                    if (blockEl) {
                        const imageToolImage = blockEl.querySelector('.image-tool__image') as HTMLElement;
                        if (imageToolImage) {
                            imageToolImage.style.width = block.data.width;
                            imageToolImage.style.maxWidth = "100%";
                            imageToolImage.style.margin = "0 auto";
                        }
                    }
                }
            });
        }).catch((err) => {
            console.error("Failed to apply image widths:", err);
        });
    };

    const handleUpdateImageWidth = async (blockId: string, newWidth: string) => {
        if (!ref.current) return;
        try {
            const block = await ref.current.blocks.getById(blockId);
            if (block) {
                const currentData = await block.save() as any;
                if (!currentData || !currentData.data) return;
                const updatedData = {
                    ...currentData.data,
                    width: newWidth
                };
                
                await ref.current.blocks.update(blockId, updatedData);
                
                const blockEl = document.querySelector(`[data-id="${blockId}"]`);
                if (blockEl) {
                    const imageToolImage = blockEl.querySelector('.image-tool__image') as HTMLElement;
                    if (imageToolImage) {
                        imageToolImage.style.width = newWidth;
                        imageToolImage.style.maxWidth = "100%";
                        imageToolImage.style.margin = "0 auto";
                    }
                }

                setSelectedImage(prev => {
                    if (prev && prev.id === blockId) {
                        return { ...prev, width: newWidth };
                    }
                    return prev;
                });

                setSavingStatus('saving');
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    onSaveDocument(false);
                    saveTimeoutRef.current = null;
                }, 1500);
            }
        } catch (e) {
            console.error("Failed to update image width in EditorJS:", e);
        }
    };

    const handleResizeStart = (e: React.MouseEvent, direction: 'left' | 'right') => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedImage) return;

        setIsDraggingResize(true);
        dragDirectionRef.current = direction;
        dragStartXRef.current = e.clientX;
        
        const parentBlock = selectedImage.element.closest('.ce-block') as HTMLElement;
        const maxBlockWidth = parentBlock ? parentBlock.offsetWidth : 650;
        
        const currentWidthPx = selectedImage.element.offsetWidth;
        dragStartWidthRef.current = currentWidthPx;

        // Disable transitions during mouse movement to make drag fluid
        selectedImage.element.style.transition = 'none';

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - dragStartXRef.current;
            const multiplier = direction === 'right' ? 2 : -2;
            let newWidthPx = dragStartWidthRef.current + (deltaX * multiplier);
            
            const minPx = maxBlockWidth * 0.1;
            const maxPx = maxBlockWidth;
            newWidthPx = Math.max(minPx, Math.min(maxPx, newWidthPx));

            const widthPercent = Math.round((newWidthPx / maxBlockWidth) * 100);
            const newWidthString = `${widthPercent}%`;

            selectedImage.element.style.width = newWidthString;
            setSelectedImage(prev => prev ? { ...prev, width: newWidthString } : null);
        };

        const handleMouseUp = () => {
            setIsDraggingResize(false);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            
            if (selectedImage) {
                selectedImage.element.style.transition = ''; // restore CSS transition
                const currentWidthPercent = selectedImage.element.style.width || "100%";
                handleUpdateImageWidth(selectedImage.id, currentWidthPercent);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    // Watch for image hover in EditorJS
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

        const container = document.getElementById('editorjs');
        if (container) {
            container.addEventListener('mousemove', handleMouseMove);
        }
        return () => {
            if (container) {
                container.removeEventListener('mousemove', handleMouseMove);
            }
        };
    }, []);

    // Watch for image selection / click in EditorJS
    useEffect(() => {
        const handleEditorClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const ceBlock = target.closest('.ce-block');
            
            // Allow clicking preset controls without deselecting
            if (target.closest('.image-resize-controls')) {
                return;
            }

            if (!ceBlock) {
                setSelectedImage(null);
                return;
            }
            
            const img = ceBlock.querySelector('img');
            const imageToolImage = ceBlock.querySelector('.image-tool__image') as HTMLElement;
            const blockId = ceBlock.getAttribute('data-id');
            
            if (img && imageToolImage && blockId) {
                const currentWidth = imageToolImage.style.width || "100%";
                setSelectedImage({
                    id: blockId,
                    element: imageToolImage,
                    img: img,
                    width: currentWidth
                });
            } else {
                setSelectedImage(null);
            }
        };

        const container = document.getElementById('editorjs');
        if (container) {
            container.addEventListener('click', handleEditorClick);
        }
        return () => {
            if (container) {
                container.removeEventListener('click', handleEditorClick);
            }
        };
    }, []);

    // Synchronize overlay position based on selection bounds
    const updateOverlayPosition = () => {
        if (!selectedImage) {
            setOverlayPos(null);
            return;
        }
        const parent = document.getElementById('editorjs')?.parentElement;
        if (!parent) return;

        const parentRect = parent.getBoundingClientRect();
        const elemRect = selectedImage.element.getBoundingClientRect();

        setOverlayPos({
            top: elemRect.top - parentRect.top,
            left: elemRect.left - parentRect.left,
            width: elemRect.width,
            height: elemRect.height
        });
    };

    useEffect(() => {
        if (selectedImage) {
            updateOverlayPosition();
            
            window.addEventListener('resize', updateOverlayPosition);
            const scrollContainer = document.querySelector('.overflow-y-auto');
            if (scrollContainer) {
                scrollContainer.addEventListener('scroll', updateOverlayPosition);
            }
            
            return () => {
                window.removeEventListener('resize', updateOverlayPosition);
                if (scrollContainer) {
                    scrollContainer.removeEventListener('scroll', updateOverlayPosition);
                }
            };
        } else {
            setOverlayPos(null);
        }
    }, [selectedImage, selectedImage?.width]);

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
                    applyImageWidths();
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
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
                    applyImageWidths();
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
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
                    applyImageWidths();
                    setTimeout(() => {
                        isProgrammaticUpdateRef.current = false;
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
                applyImageWidths();
                if (isProgrammaticUpdateRef.current) {
                    return;
                }
                // Zero-Latency Doc Syncing: Save immediately instead of debouncing
                onSaveDocument(false);
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

            {/* Smooth Lossless Image Resize Overlay and Toolbar */}
            {selectedImage && overlayPos && (
                <div
                    style={{
                        position: 'absolute',
                        top: overlayPos.top,
                        left: overlayPos.left,
                        width: overlayPos.width,
                        height: overlayPos.height,
                        pointerEvents: isDraggingResize ? 'all' : 'none',
                        zIndex: 30,
                    }}
                    className="group/resize-overlay border-2 border-dashed border-violet-500/80 rounded-lg shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-shadow duration-300"
                >
                    {/* Left Drag Handle */}
                    <div
                        onMouseDown={(e) => handleResizeStart(e, 'left')}
                        style={{
                            position: 'absolute',
                            left: -6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'all',
                            cursor: 'ew-resize',
                        }}
                        className="w-3 h-8 bg-gradient-to-b from-violet-600 to-indigo-600 rounded-full shadow-[0_0_8px_rgba(139,92,246,0.5)] border border-white hover:scale-110 active:scale-95 transition-transform"
                    />

                    {/* Right Drag Handle */}
                    <div
                        onMouseDown={(e) => handleResizeStart(e, 'right')}
                        style={{
                            position: 'absolute',
                            right: -6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'all',
                            cursor: 'ew-resize',
                        }}
                        className="w-3 h-8 bg-gradient-to-b from-violet-600 to-indigo-600 rounded-full shadow-[0_0_8px_rgba(139,92,246,0.5)] border border-white hover:scale-110 active:scale-95 transition-transform"
                    />

                    {/* Premium Glassmorphic Resize Control Toolbar */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: -54,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            pointerEvents: 'all',
                        }}
                        className="image-resize-controls flex items-center gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-700/50 rounded-xl px-4 py-2 shadow-2xl z-40 min-w-[280px]"
                    >
                        <div className="flex gap-1.5 border-r border-slate-800 pr-3">
                            {['25%', '50%', '75%', '100%'].map((w) => {
                                const isActive = selectedImage.width === w;
                                return (
                                    <button
                                        key={w}
                                        onClick={() => handleUpdateImageWidth(selectedImage.id, w)}
                                        className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                                            isActive
                                                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md'
                                                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                                        }`}
                                    >
                                        {w}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Slider Control */}
                        <div className="flex items-center gap-2 flex-grow pl-1">
                            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">Size:</span>
                            <input
                                type="range"
                                min="10"
                                max="100"
                                value={parseInt(selectedImage.width) || 100}
                                onChange={(e) => handleUpdateImageWidth(selectedImage.id, `${e.target.value}%`)}
                                className="w-24 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                            />
                            <span className="text-[10px] text-violet-400 font-bold whitespace-nowrap min-w-[24px]">
                                {parseInt(selectedImage.width) || 100}%
                            </span>
                        </div>
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