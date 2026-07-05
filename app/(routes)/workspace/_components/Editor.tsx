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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { FILE } from '../../dashboard/_components/FileList';

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
    const ref=useRef<EditorJS>();
    const updateDocument=useMutation(api.files.updateDocument);
    const saveTimeoutRef=useRef<NodeJS.Timeout|null>(null);
    const lastSavedDataRef=useRef<string>("");

    // Undo/Redo History Stack (client-side)
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef<number>(-1);

    // Keep track of trigger changes to avoid firing on initial mount
    const lastUndoTriggerRef = useRef(0);
    const lastRedoTriggerRef = useRef(0);

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
            const serverDoc = JSON.parse(fileData.document);
            const serverStr = JSON.stringify(serverDoc);
            
            // If server data matches what we last saved/rendered, do nothing (prevents feedback loop)
            if (serverStr === lastSavedDataRef.current) {
                return;
            }
            
            // Only overwrite if we are not currently typing or waiting on a debounced save
            if (saveTimeoutRef.current === null && !saveTimeoutRef.current) {
                ref.current.render(serverDoc);
                lastSavedDataRef.current = serverStr;
                
                // Initialize/reset history stack to match this new server state
                historyRef.current = [serverStr];
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
                ref.current.render(prevState);
                lastSavedDataRef.current = prevStateStr;
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
                ref.current.render(nextState);
                lastSavedDataRef.current = nextStateStr;
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
        updateDocument({
            _id: fileId,
            document: stateStr
        }).then(() => {
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 1000);
        }).catch(() => {
            setSavingStatus('idle');
        });
    };

    const initEditor=()=>{
        const initialDocStr = fileData?.document || JSON.stringify(rawDocument);
        lastSavedDataRef.current = initialDocStr;
        
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
            },
           
            holder: 'editorjs',
            data: fileData?.document ? JSON.parse(fileData.document) : rawDocument,
            
            onChange: () => {
                setSavingStatus('saving');
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    onSaveDocument(false);
                    saveTimeoutRef.current = null;
                }, 1500);
            }
          });
          ref.current=editor;
    }

    const onSaveDocument=(showToast = false)=>{
      if(ref.current)
      {
        setSavingStatus('saving');
        ref.current.save().then((outputData) => {
          const docStr = JSON.stringify(outputData);
          lastSavedDataRef.current = docStr;

          // Maintain the undo/redo history stack
          if (historyIndexRef.current < historyRef.current.length - 1) {
              // Truncate any forward history if editing from an undone state
              historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
          }
          
          if (historyRef.current[historyIndexRef.current] !== docStr) {
              historyRef.current.push(docStr);
              // Max stack of 50
              if (historyRef.current.length > 50) historyRef.current.shift();
              historyIndexRef.current = historyRef.current.length - 1;
              if (onHistoryChange && activePanel === 'document') {
                  onHistoryChange(historyIndexRef.current > 0, false);
              }
          }

          updateDocument({
            _id:fileId,
            document:docStr
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
  return (
    <div>
        <div id='editorjs' className='ml-20'></div>
    </div>
  )
}

export default Editor