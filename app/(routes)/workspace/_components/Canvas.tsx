import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface CanvasProps {
    onSaveTrigger: any;
    fileId: any;
    fileData: FILE;
    setSavingStatus: (status: 'idle' | 'saving' | 'saved') => void;
    undoTrigger: number;
    redoTrigger: number;
    activePanel: 'document' | 'canvas';
}

const SYSTEM_NODES = [
  { type: 'ec2', label: 'AWS EC2', emoji: '☁️', stroke: '#2563eb', fill: '#eff6ff' },
  { type: 's3', label: 'AWS S3', emoji: '📦', stroke: '#d97706', fill: '#fffbeb' },
  { type: 'rds', label: 'AWS RDS', emoji: '🗄️', stroke: '#059669', fill: '#ecfdf5' },
  { type: 'lambda', label: 'AWS Lambda', emoji: '⚡', stroke: '#7c3aed', fill: '#faf5ff' },
  { type: 'apigw', label: 'API Gateway', emoji: '🔌', stroke: '#db2777', fill: '#fdf2f8' },
  { type: 'dynamodb', label: 'DynamoDB', emoji: '🔑', stroke: '#4f46e5', fill: '#f5f3ff' },
  { type: 'vpc', label: 'AWS VPC', emoji: '🛡️', stroke: '#0891b2', fill: '#f0fdfa' },
  { type: 'server', label: 'Server', emoji: '🖥️', stroke: '#4b5563', fill: '#f9fafb' },
  { type: 'db', label: 'Database', emoji: '💾', stroke: '#059669', fill: '#ecfdf5' },
  { type: 'client', label: 'Client / User', emoji: '👤', stroke: '#ea580c', fill: '#fff7ed' }
];

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

    const handleInsertNode = (node: any) => {
        if (!excalidrawAPI) {
            toast.error("Excalidraw API not loaded yet.");
            return;
        }

        const currentElements = excalidrawAPI.getSceneElements() || [];
        
        // Compute good viewport position based on panning and zoom
        const scrollX = excalidrawAPI.getAppState()?.scrollX || 0;
        const scrollY = excalidrawAPI.getAppState()?.scrollY || 0;
        const zoomValue = excalidrawAPI.getAppState()?.zoom?.value || 1;
        
        const x = -scrollX + 150 / zoomValue;
        const y = -scrollY + 120 / zoomValue;

        const boxId = `box_${Math.random().toString(36).substr(2, 9)}`;
        const textId = `text_${Math.random().toString(36).substr(2, 9)}`;

        const boxElement = {
            type: "rectangle",
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000),
            isDeleted: false,
            id: boxId,
            x: x,
            y: y,
            width: 130,
            height: 64,
            strokeColor: node.stroke,
            backgroundColor: node.fill,
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            roughness: 0,
            opacity: 100,
            angle: 0,
            strokeSharpness: "round",
            boundElements: [{ type: "text", id: textId }],
            updated: Date.now(),
            link: null,
            locked: false
        };

        const textElement = {
            type: "text",
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000),
            isDeleted: false,
            id: textId,
            x: x + 15,
            y: y + 22,
            width: 100,
            height: 20,
            strokeColor: "#1e293b",
            backgroundColor: "transparent",
            fillStyle: "hachure",
            strokeWidth: 1,
            strokeStyle: "solid",
            roughness: 0,
            opacity: 100,
            angle: 0,
            text: `${node.emoji} ${node.label}`,
            fontSize: 12,
            fontFamily: 1,
            textAlign: "center",
            verticalAlign: "middle",
            containerId: boxId,
            originalText: `${node.emoji} ${node.label}`,
            updated: Date.now(),
            link: null,
            locked: false
        };

        const newElements = [...currentElements, boxElement, textElement];
        
        excalidrawAPI.updateScene({
            elements: newElements
        });
        
        handleCanvasChange(newElements);
        toast.success(`Inserted ${node.label} node!`);
    };

    return (
    <div style={{ height: "calc(100vh - 80px)", position: "relative" }}>
      {/* Floating System Design Toolset */}
      <div className="absolute top-4 left-4 z-[99] flex flex-col gap-2 bg-white/90 backdrop-blur-md dark:bg-slate-900/90 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800/80 shadow-xl max-w-[170px] pointer-events-auto">
        <div className="flex items-center gap-1.5 pb-2 mb-1 border-b border-slate-100 dark:border-slate-800">
          <Sparkles className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
          <span className="text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider">Quick Symbols</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-[220px] overflow-y-auto pr-1">
          {SYSTEM_NODES.map((node) => (
            <button
              key={node.type}
              onClick={() => handleInsertNode(node)}
              className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-slate-50 hover:bg-blue-50/60 border border-slate-100 hover:border-blue-200 dark:bg-slate-950 dark:hover:bg-blue-950/20 dark:border-zinc-900 dark:hover:border-blue-900/30 transition-all active:scale-95 group"
              title={`Insert ${node.label}`}
            >
              <span className="text-base group-hover:scale-110 transition-transform">{node.emoji}</span>
              <span className="text-[9px] font-bold text-slate-500 dark:text-zinc-400 mt-1 truncate max-w-full text-center group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {node.label.replace('AWS ', '')}
              </span>
            </button>
          ))}
        </div>
      </div>

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