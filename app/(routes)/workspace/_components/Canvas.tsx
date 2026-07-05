import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Sparkles, Cloud, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AWS_ICONS } from './aws_icons_list';

const fetchSVGAsBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch SVG");
    const svgText = await response.text();
    
    // Ensure standard attributes like xmlns are on the root svg tag if missing
    let modifiedSvg = svgText;
    if (!modifiedSvg.includes('xmlns=')) {
        modifiedSvg = modifiedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    // Robust base64 encoding supporting unicode
    const utf8Bytes = new TextEncoder().encode(modifiedSvg);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
        binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:image/svg+xml;base64,${base64}`;
};



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

    const [activeTab, setActiveTab] = useState<'standard' | 'aws'>('aws');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [loadingIcon, setLoadingIcon] = useState<string | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    // Self-Healing Session Restorer for AWS Icons
    useEffect(() => {
        if (!excalidrawAPI || !fileData?.whiteboard) return;

        const restoreAWSIcons = async () => {
            try {
                const elements = excalidrawAPI.getSceneElements() || [];
                const currentFiles = excalidrawAPI.getFiles() || {};
                
                // Find all image elements with aws__ fileId that aren't registered yet in Excalidraw session
                const awsImageElements = elements.filter((el: any) => 
                    el.type === "image" && 
                    el.fileId && 
                    el.fileId.startsWith("aws__") && 
                    !currentFiles[el.fileId]
                );

                if (awsImageElements.length === 0) return;

                const filesToRegister: any[] = [];
                for (const el of awsImageElements) {
                    const icon = AWS_ICONS.find(i => i.id === el.fileId);
                    if (icon) {
                        try {
                            const base64 = await fetchSVGAsBase64(icon.url);
                            filesToRegister.push({
                                id: icon.id,
                                dataURL: base64,
                                mimeType: "image/svg+xml"
                            });
                        } catch (err) {
                            console.error(`Failed to restore AWS icon ${icon.id}:`, err);
                        }
                    }
                }

                if (filesToRegister.length > 0) {
                    await excalidrawAPI.addFiles(filesToRegister);
                    // Force scene update so the images render
                    excalidrawAPI.updateScene({
                        elements: excalidrawAPI.getSceneElements()
                    });
                }
            } catch (e) {
                console.error("Error in self-healing AWS icons restorer:", e);
            }
        };

        restoreAWSIcons();
    }, [excalidrawAPI, fileData?.whiteboard]);

    const handleDragStart = (e: React.DragEvent, icon: any, type: 'standard' | 'aws') => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ icon, type }));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        if (!excalidrawAPI) return;

        try {
            const dataStr = e.dataTransfer.getData('text/plain');
            if (!dataStr) return;

            const { icon, type } = JSON.parse(dataStr);
            
            const container = e.currentTarget as HTMLDivElement;
            const rect = container.getBoundingClientRect();
            const clientX = e.clientX;
            const clientY = e.clientY;

            const appState = excalidrawAPI.getAppState() || {};
            const scrollX = appState.scrollX || 0;
            const scrollY = appState.scrollY || 0;
            const zoomValue = appState.zoom?.value || 1;

            const x = (clientX - rect.left) / zoomValue - scrollX;
            const y = (clientY - rect.top) / zoomValue - scrollY;

            if (type === 'standard') {
                handleInsertNode(icon, x, y);
            } else if (type === 'aws') {
                handleInsertAWSNode(icon, x, y);
            }
        } catch (err) {
            console.error("Error handling dropped node:", err);
        }
    };

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

    const handleInsertNode = (node: any, customX?: number, customY?: number) => {
        if (!excalidrawAPI) {
            toast.error("Excalidraw API not loaded yet.");
            return;
        }

        const currentElements = excalidrawAPI.getSceneElements() || [];
        
        let x = 0;
        let y = 0;
        if (customX !== undefined && customY !== undefined) {
            x = customX;
            y = customY;
        } else {
            // Compute good viewport position based on panning and zoom
            const scrollX = excalidrawAPI.getAppState()?.scrollX || 0;
            const scrollY = excalidrawAPI.getAppState()?.scrollY || 0;
            const zoomValue = excalidrawAPI.getAppState()?.zoom?.value || 1;
            
            x = -scrollX + 150 / zoomValue;
            y = -scrollY + 120 / zoomValue;
        }

        const boxId = `box_${Math.random().toString(36).substr(2, 9)}`;
        const textId = `text_${Math.random().toString(36).substr(2, 9)}`;
        const groupId = `group_${Math.random().toString(36).substr(2, 9)}`;

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
            locked: false,
            // Group and Excalidraw-vital fields to avoid clicks/select crashing
            groupIds: [groupId],
            seed: Math.floor(Math.random() * 1000000),
            frameId: null,
            roundness: { type: 3 }
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
            locked: false,
            // Group and Excalidraw-vital fields to avoid clicks/select crashing
            groupIds: [groupId],
            seed: Math.floor(Math.random() * 1000000),
            frameId: null,
            roundness: null,
            baseline: 16,
            lineHeight: 1.25,
            boundElements: null
        };

        const newElements = [...currentElements, boxElement, textElement];
        
        excalidrawAPI.updateScene({
            elements: newElements
        });
        
        handleCanvasChange(newElements);
        toast.success(`Inserted ${node.label} node!`);
    };

    const handleInsertAWSNode = async (icon: any, customX?: number, customY?: number) => {
        if (!excalidrawAPI) {
            toast.error("Excalidraw API not loaded yet.");
            return;
        }

        setLoadingIcon(icon.id);
        try {
            const base64 = await fetchSVGAsBase64(icon.url);
            const currentElements = excalidrawAPI.getSceneElements() || [];
            
            let x = 0;
            let y = 0;
            if (customX !== undefined && customY !== undefined) {
                x = customX;
                y = customY;
            } else {
                // Compute viewport coordinates based on panning and zoom
                const scrollX = excalidrawAPI.getAppState()?.scrollX || 0;
                const scrollY = excalidrawAPI.getAppState()?.scrollY || 0;
                const zoomValue = excalidrawAPI.getAppState()?.zoom?.value || 1;
                
                x = -scrollX + 150 / zoomValue;
                y = -scrollY + 120 / zoomValue;
            }

            const imageId = `img_${Math.random().toString(36).substr(2, 9)}`;
            const textId = `text_${Math.random().toString(36).substr(2, 9)}`;
            const groupId = `group_${Math.random().toString(36).substr(2, 9)}`;

            const imageElement = {
                type: "image",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: imageId,
                x: x,
                y: y,
                width: 60,
                height: 60,
                angle: 0,
                strokeColor: "transparent",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 0,
                opacity: 100,
                status: "pending",
                fileId: icon.id,
                scale: [1, 1],
                locked: false,
                groupIds: [groupId],
                frameId: null,
                roundness: null,
                seed: Math.floor(Math.random() * 1000000),
                updated: Date.now(),
                link: null
            };

            const textElement = {
                type: "text",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: textId,
                x: x - 30, // Centered below 60px image
                y: y + 65,
                width: 120,
                height: 30,
                strokeColor: "#334155",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 0,
                opacity: 100,
                angle: 0,
                text: icon.label,
                fontSize: 11,
                fontFamily: 1,
                textAlign: "center",
                verticalAlign: "middle",
                originalText: icon.label,
                updated: Date.now(),
                link: null,
                locked: false,
                groupIds: [groupId],
                frameId: null,
                roundness: null,
                seed: Math.floor(Math.random() * 1000000),
                baseline: 13,
                lineHeight: 1.25,
                boundElements: null
            };

            const newElements = [...currentElements, imageElement, textElement];
            
            const filesObj = {
                [icon.id]: {
                    id: icon.id,
                    dataURL: base64,
                    mimeType: "image/svg+xml",
                    created: Date.now()
                }
            };

            excalidrawAPI.updateScene({
                elements: newElements,
                files: filesObj
            });
            
            handleCanvasChange(newElements);
            toast.success(`Inserted ${icon.label}!`);
        } catch (err) {
            console.error("Error inserting AWS icon:", err);
            toast.error("Failed to insert AWS icon.");
        } finally {
            setLoadingIcon(null);
        }
    };

    const filteredAWSIcons = AWS_ICONS.filter(icon => {
        const matchesCategory = selectedCategory === 'all' || icon.category === selectedCategory;
        const matchesQuery = icon.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             icon.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesQuery;
    });

    const displayedIcons = filteredAWSIcons.slice(0, 100);

    return (
    <div 
      style={{ height: "calc(100vh - 80px)", position: "relative" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Floating System Design Toolset */}
      {isSidebarCollapsed ? (
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="absolute top-4 left-4 z-[99] flex items-center gap-2 bg-white/95 backdrop-blur-md hover:bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60 shadow-xl pointer-events-auto transition-all active:scale-95 text-slate-800"
          title="Expand Panel"
        >
          <Cloud className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Canvas Elements</span>
          <ChevronRight className="h-4 w-4 text-slate-400 ml-1" />
        </button>
      ) : (
        <div className="absolute top-4 left-4 z-[99] flex flex-col bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xl w-[280px] h-[460px] pointer-events-auto overflow-hidden transition-all">
          {/* Header */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all mr-0.5"
                title="Collapse Panel"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Cloud className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider">Canvas Elements</span>
            </div>
            {/* Quick Tab Switcher */}
            <div className="flex p-0.5 bg-slate-100 rounded-lg text-[10px] font-bold">
              <button
                onClick={() => setActiveTab('standard')}
                className={`px-2 py-1 rounded-md transition-all ${activeTab === 'standard' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Standard
              </button>
              <button
                onClick={() => setActiveTab('aws')}
                className={`px-2 py-1 rounded-md transition-all ${activeTab === 'aws' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                AWS
              </button>
            </div>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0">
            {activeTab === 'standard' ? (
              <div className="grid grid-cols-2 gap-2">
                {SYSTEM_NODES.map((node) => (
                  <button
                    key={node.type}
                    onClick={() => handleInsertNode(node)}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, node, 'standard')}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 hover:bg-blue-50/60 border border-slate-100 hover:border-blue-200 transition-all active:scale-95 group cursor-grab active:cursor-grabbing"
                    title={`Drag or Click to insert ${node.label}`}
                  >
                    <span className="text-xl group-hover:scale-110 transition-transform">{node.emoji}</span>
                    <span className="text-[10px] font-bold text-slate-500 mt-1 truncate max-w-full text-center group-hover:text-blue-600">
                      {node.label.replace('AWS ', '')}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 gap-2">
                {/* AWS Search Bar */}
                <div className="relative shrink-0">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search 800+ AWS Icons..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-800"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* AWS Category Tabs */}
                <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-slate-200 select-none shrink-0">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'architecture-service', label: 'Service' },
                    { id: 'resource', label: 'Resource' },
                    { id: 'architecture-group', label: 'Group' },
                    { id: 'category', label: 'Category' }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border shrink-0 transition-all ${selectedCategory === cat.id ? 'bg-blue-500 text-white border-blue-500' : 'bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100'}`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* AWS Icons Grid */}
                <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-3 gap-1.5 min-h-0">
                  {displayedIcons.map((icon) => (
                    <button
                      key={icon.id}
                      disabled={loadingIcon !== null}
                      onClick={() => handleInsertAWSNode(icon)}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, icon, 'aws')}
                      className={`flex flex-col items-center justify-between p-1.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-blue-50/50 hover:border-blue-200 transition-all group active:scale-95 h-[76px] relative cursor-grab active:cursor-grabbing ${loadingIcon === icon.id ? 'opacity-70 border-blue-500 bg-blue-50/20' : ''}`}
                      title={`Drag or Click to insert ${icon.label}`}
                    >
                      {loadingIcon === icon.id ? (
                        <div className="flex-1 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center p-0.5">
                          <img 
                            src={icon.url} 
                            alt={icon.label} 
                            className="w-8 h-8 object-contain group-hover:scale-110 transition-transform"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <span className="text-[8px] leading-tight font-semibold text-slate-500 text-center line-clamp-2 w-full mt-1 group-hover:text-blue-600">
                        {icon.label.replace(/^Amazon\s+|AWS\s+/, '')}
                      </span>
                    </button>
                  ))}
                </div>
                
                {/* Pagination/Status line */}
                <div className="text-[8px] text-slate-400 font-semibold px-1 text-center mt-1 border-t border-slate-100 pt-1.5 shrink-0">
                  {filteredAWSIcons.length > 100 
                    ? `Showing first 100 of ${filteredAWSIcons.length} matching icons` 
                    : `Found ${filteredAWSIcons.length} matching icons`}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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