import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

interface CanvasProps {
    onSaveTrigger: any;
    fileId: any;
    fileData: FILE;
    setSavingStatus: (status: 'idle' | 'saving' | 'saved') => void;
    undoTrigger: number;
    redoTrigger: number;
    activePanel: 'document' | 'canvas';
}

function Canvas({
    onSaveTrigger,
    fileId,
    fileData,
    setSavingStatus,
    undoTrigger,
    redoTrigger,
    activePanel
}: CanvasProps) {
    const [whiteBoardData,setWhiteBoardData]=useState<any>();
    const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
    const updateWhiteboard=useMutation(api.files.updateWhiteboard)
    const saveTimeoutRef=useRef<NodeJS.Timeout|null>(null);
    const lastSavedDataRef=useRef<string>("");

    // Keep track of trigger changes to avoid firing on initial mount
    const lastUndoTriggerRef = useRef(0);
    const lastRedoTriggerRef = useRef(0);

    useEffect(()=>{
        onSaveTrigger&&saveWhiteboard();
    },[onSaveTrigger])

    useEffect(() => {
        if (fileData?.whiteboard) {
            lastSavedDataRef.current = fileData.whiteboard;
        }
    }, [fileData]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        }
    }, []);

    // Listen to real-time sync updates from database polling
    useEffect(() => {
        if (!excalidrawAPI || !fileData?.whiteboard) return;
        
        try {
            const serverElements = JSON.parse(fileData.whiteboard);
            const serverStr = JSON.stringify(serverElements);
            
            // If server data matches what we last saved/rendered, do nothing (feedback loop protection)
            if (serverStr === lastSavedDataRef.current) {
                return;
            }
            
            // Only overwrite if we are not currently drawing/saving (idle)
            if (saveTimeoutRef.current === null && !saveTimeoutRef.current) {
                excalidrawAPI.updateScene({
                    elements: serverElements
                });
                lastSavedDataRef.current = serverStr;
            }
        } catch (e) {
            console.error("Error updating canvas from realtime sync:", e);
        }
    }, [fileData?.whiteboard, excalidrawAPI]);

    // Handle incoming Undo Trigger from Header toolbar
    useEffect(() => {
        if (activePanel !== 'canvas' || !excalidrawAPI) return;
        if (undoTrigger > lastUndoTriggerRef.current) {
            lastUndoTriggerRef.current = undoTrigger;
            excalidrawAPI.history.undo();
        }
    }, [undoTrigger, activePanel, excalidrawAPI]);

    // Handle incoming Redo Trigger from Header toolbar
    useEffect(() => {
        if (activePanel !== 'canvas' || !excalidrawAPI) return;
        if (redoTrigger > lastRedoTriggerRef.current) {
            lastRedoTriggerRef.current = redoTrigger;
            excalidrawAPI.history.redo();
        }
    }, [redoTrigger, activePanel, excalidrawAPI]);

    const saveWhiteboard=()=>{
        setSavingStatus('saving');
        updateWhiteboard({
            _id:fileId,
            whiteboard:JSON.stringify(whiteBoardData)
        }).then(resp=>{
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 2000);
        }).catch(() => {
            setSavingStatus('idle');
        });
    }

    const handleCanvasChange = (excalidrawElements: any) => {
        setWhiteBoardData(excalidrawElements);
        
        const currentDataStr = JSON.stringify(excalidrawElements);
        // Avoid auto-saving if elements didn't change (e.g. on simple pan/zoom view changes)
        if (currentDataStr === lastSavedDataRef.current || !excalidrawElements || excalidrawElements.length === 0) {
            return;
        }

        setSavingStatus('saving');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            updateWhiteboard({
                _id: fileId,
                whiteboard: currentDataStr
            }).then(() => {
                lastSavedDataRef.current = currentDataStr;
                setSavingStatus('saved');
                setTimeout(() => setSavingStatus('idle'), 2000);
                saveTimeoutRef.current = null;
            }).catch(() => {
                setSavingStatus('idle');
            });
        }, 1500);
    };

    return (
    <div style={{ height: "670px" }}>
   {fileData&& <Excalidraw 
    theme='light'
    excalidrawAPI={(api) => setExcalidrawAPI(api)}
    initialData={{
        elements:fileData?.whiteboard&&JSON.parse(fileData?.whiteboard)
    }}
    onChange={handleCanvasChange}
    UIOptions={{
        canvasActions:{
            saveToActiveFile:false,
            loadScene:false,
            export:false,
            toggleTheme:false

        }
    }}
    >
        <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas/>
            <MainMenu.DefaultItems.SaveAsImage/>
            <MainMenu.DefaultItems.ChangeCanvasBackground/>
        </MainMenu>
        <WelcomeScreen>
            <WelcomeScreen.Hints.MenuHint/>
            <WelcomeScreen.Hints.MenuHint/>
            <WelcomeScreen.Hints.ToolbarHint/>
            <WelcomeScreen.Center>
                <WelcomeScreen.Center.MenuItemHelp/>
            </WelcomeScreen.Center>
        </WelcomeScreen>
        </Excalidraw>}
  </div>
  )
}

export default Canvas