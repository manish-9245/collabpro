import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { api, useMutation, useQuery } from '@/lib/state-sync/react';
import { encodeCrdtState, decodeCrdtState } from '@/lib/crdt';
import { Sparkles, Cloud, Search, Loader2, ChevronLeft, ChevronRight, Plus, Trash2, Upload, BookOpen, Link, Check, Download, Info, Globe } from 'lucide-react';
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
  { id: 'std__ec2', label: 'AWS EC2', stroke: '#3b82f6', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AmazonEC2.svg" },
  { id: 'std__s3', label: 'AWS S3', stroke: '#f59e0b', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/SimpleStorageService.svg" },
  { id: 'std__rds', label: 'AWS RDS', stroke: '#10b981', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AmazonRDS.svg" },
  { id: 'std__lambda', label: 'AWS Lambda', stroke: '#8b5cf6', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AWSLambda.svg" },
  { id: 'std__apigw', label: 'API Gateway', stroke: '#ec4899', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AmazonAPIGateway.svg" },
  { id: 'std__dynamodb', label: 'DynamoDB', stroke: '#6366f1', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AmazonDynamoDB.svg" },
  { id: 'std__vpc', label: 'AWS VPC', stroke: '#06b6d4', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AmazonVPC.svg" },
  { id: 'std__server', label: 'Server', stroke: '#64748b', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/resource/AmazonEC2Instance.svg" },
  { id: 'std__db', label: 'Database', stroke: '#10b981', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/resource/Database.svg" },
  { id: 'std__client', label: 'Client / User', stroke: '#f97316', fill: '#ffffff', url: "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/resource/User.svg" }
];

const CURATED_LIBRARIES = [
  {
    id: "software-architecture",
    name: "Software Architecture",
    description: "Microservices, databases, caches, pipelines, browsers...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/youritjang/software-architecture.excalidrawlib",
    author: "Youri Tjang"
  },
  {
    id: "system-design-components",
    name: "System Design Components",
    description: "Cloud infra, servers, databases, streams, and caches...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/rohanp/system-design.excalidrawlib",
    author: "Rohan Pithadiya"
  },
  {
    id: "system-design-icons",
    name: "System Design Icons",
    description: "Load balancers, CDN, queues, clusters, services...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/niknm/systemdesignicons.excalidrawlib",
    author: "niknm"
  },
  {
    id: "system-design-template",
    name: "System Design Template",
    description: "Structured blocks, templates, and interview layouts...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/aretecode/system-design-template.excalidrawlib",
    author: "aretecode"
  },
  {
    id: "cloud-design-patterns",
    name: "Cloud Design Patterns",
    description: "Azure & cloud app design patterns & architecture concepts...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/michelcaradec/cloud-design-patterns.excalidrawlib",
    author: "Michel Caradec"
  },
  {
    id: "uml-er",
    name: "Shapes for UML & ER",
    description: "Opinionated shapes for class and ER diagrams...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/BjoernKW/UML-ER-library.excalidrawlib",
    author: "BjoernKW"
  },
  {
    id: "it-logos",
    name: "IT Logos (K8s, Docker...)",
    description: "Kubernetes, Docker, Git, Python, React, Vercel, VSCode...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/pclainchard/it-logos.excalidrawlib",
    author: "Pierre Clainchard"
  },
  {
    id: "azure-cloud",
    name: "Azure Cloud Services",
    description: "Compute, databases, networks, and developer tools...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/youritjang/azure-cloud-services.excalidrawlib",
    author: "Youri Tjang"
  },
  {
    id: "cloud-symbols",
    name: "Cloud Symbols (K8s, GCP...)",
    description: "Gardener, K8s, GCP, Azure, AWS and architecture logos...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/cloud/cloud.excalidrawlib",
    author: "rfranzke"
  },
  {
    id: "hexagonal-architecture",
    name: "Hexagonal Architecture",
    description: "Ports, adapters, domain modeling, and boundary mapping...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/corlaez/hexagonal-architecture.excalidrawlib",
    author: "corlaez"
  },
  {
    id: "info-arch",
    name: "Information Architecture",
    description: "Pages, stacks, decision points, conditional areas...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/inwardmovement/information-architecture.excalidrawlib",
    author: "inwardmovement"
  },
  {
    id: "aws-architecture-icons",
    name: "AWS Architecture",
    description: "Official Amazon Web Services cloud architecture icons...",
    url: "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/narhari-motivaras/aws-architecture-icons.excalidrawlib",
    author: "Narhari Motivaras"
  }
];

const getItemName = (elements: any[], index: number, itemNames?: string[]) => {
  if (itemNames && itemNames[index]) {
    return itemNames[index];
  }
  const textEl = elements.find((el: any) => el.type === "text");
  if (textEl && textEl.text) {
    return textEl.text.trim();
  }
  const types = Array.from(new Set(elements.map((el: any) => el.type)));
  if (types.length === 1) {
    return `${types[0].charAt(0).toUpperCase() + types[0].slice(1)}`;
  }
  return `Asset ${index + 1}`;
};

const LibraryItemPreview = ({ elements }: { elements: any[] }) => {
  if (!elements || elements.length === 0) {
    return (
      <svg className="w-full h-full text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  // 1. Calculate bounding box of all elements
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach((el: any) => {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;

    if (el.points && el.points.length > 0) {
      el.points.forEach((p: any) => {
        const px = x + (p[0] ?? 0);
        const py = y + (p[1] ?? 0);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      });
    } else {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  });

  // If bounds are invalid or zero, use fallback
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    return (
      <svg className="w-full h-full text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    );
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const maxDim = Math.max(width, height);
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  const size = 100;
  const padding = 12; // nice padding to keep shapes inside
  const scale = (size - 2 * padding) / maxDim;

  const scaleX = (x: number) => (x - centerX) * scale + size / 2;
  const scaleY = (y: number) => (y - centerY) * scale + size / 2;
  const scaleW = (w: number) => w * scale;
  const scaleH = (h: number) => h * scale;

  return (
    <svg className="w-full h-full text-[#6965db] dark:text-[#8572e3]" viewBox="0 0 100 100">
      {elements.map((el: any, idx: number) => {
        const x = el.x ?? 0;
        const y = el.y ?? 0;
        const w = el.width ?? 0;
        const h = el.height ?? 0;
        const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'none';
        const strokeDashed = el.strokeStyle === 'dashed' ? '4,4' : el.strokeStyle === 'dotted' ? '2,2' : undefined;

        // Common styles to keep it neat
        const shapeProps = {
          key: idx,
          stroke: "currentColor",
          strokeWidth: 2,
          strokeDasharray: strokeDashed,
          fill: fill !== 'none' ? 'currentColor' : 'none',
          fillOpacity: fill !== 'none' ? 0.15 : undefined,
          className: "transition-colors duration-200"
        };

        if (el.type === "rectangle") {
          return (
            <rect
              {...shapeProps}
              x={scaleX(x)}
              y={scaleY(y)}
              width={scaleW(w)}
              height={scaleH(h)}
              rx={el.roundness ? 4 : 0}
            />
          );
        }

        if (el.type === "ellipse") {
          return (
            <ellipse
              {...shapeProps}
              cx={scaleX(x + w / 2)}
              cy={scaleY(y + h / 2)}
              rx={scaleW(w / 2)}
              ry={scaleH(h / 2)}
            />
          );
        }

        if (el.type === "diamond") {
          const p1 = `${scaleX(x + w / 2)},${scaleY(y)}`;
          const p2 = `${scaleX(x + w)},${scaleY(y + h / 2)}`;
          const p3 = `${scaleX(x + w / 2)},${scaleY(y + h)}`;
          const p4 = `${scaleX(x)},${scaleY(y + h / 2)}`;
          return (
            <polygon
              {...shapeProps}
              points={`${p1} ${p2} ${p3} ${p4}`}
            />
          );
        }

        if ((el.type === "line" || el.type === "arrow") && el.points && el.points.length > 0) {
          const pathData = el.points
            .map((p: any, i: number) => `${i === 0 ? 'M' : 'L'} ${scaleX(x + (p[0] ?? 0))} ${scaleY(y + (p[1] ?? 0))}`)
            .join(' ');
          return (
            <path
              {...shapeProps}
              d={pathData}
              fill="none"
            />
          );
        }

        if (el.type === "text") {
          const cleanText = (el.text ?? '').trim();
          const displayChar = cleanText.length > 0 ? (cleanText.length <= 4 ? cleanText : cleanText.substring(0, 2)) : 'T';
          return (
            <text
              key={idx}
              x={scaleX(x + w / 2)}
              y={scaleY(y + h / 2)}
              dominantBaseline="middle"
              textAnchor="middle"
              fontSize={Math.max(12, Math.min(24, scaleW(el.fontSize || 16) * 0.8))}
              fill="currentColor"
              fontWeight="bold"
              className="select-none font-sans"
            >
              {displayChar}
            </text>
          );
        }

        // Fallback representation
        return (
          <line
            {...shapeProps}
            x1={scaleX(x)}
            y1={scaleY(y)}
            x2={scaleX(x + w)}
            y2={scaleY(y + h)}
          />
        );
      })}
    </svg>
  );
};

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
    const upsertSharedLibraryItem = useMutation(api.sharedLibrary.upsertItem);
    const sharedLibraryItems = useQuery(
      api.sharedLibrary.getItems,
      fileData?.teamId ? { teamId: fileData.teamId } : 'skip' as any
    );
    const saveTimeoutRef=useRef<NodeJS.Timeout|null>(null);
    const lastSavedDataRef=useRef<string>("");

    const [activeTab, setActiveTab] = useState<'standard' | 'aws' | 'custom' | 'libraries'>('standard');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [loadingIcon, setLoadingIcon] = useState<string | null>(null);
    const [includeLabel, setIncludeLabel] = useState(true);
    const [includeCard, setIncludeCard] = useState(true);

    // Custom library state persisted in localStorage
    const [customIcons, setCustomIcons] = useState<any[]>([]);
    const [customName, setCustomName] = useState('');
    const [customUrl, setCustomUrl] = useState('');
    const [customCategory, setCustomCategory] = useState('');
    const [isAddFormOpen, setIsAddFormOpen] = useState(false);
    const [selectedCustomCategory, setSelectedCustomCategory] = useState('all');

    // Extensible Community Libraries State
    const [loadedLibraries, setLoadedLibraries] = useState<any[]>([]);
    const [selectedLibraryId, setSelectedLibraryId] = useState<string>('software-architecture');
    const [librarySearchQuery, setLibrarySearchQuery] = useState('');
    const [loadingLibrary, setLoadingLibrary] = useState<string | null>(null);
    const [customLibraryUrl, setCustomLibraryUrl] = useState('');
    const [isAddLibFormOpen, setIsAddLibFormOpen] = useState(false);
    const [customLibrariesList, setCustomLibrariesList] = useState<any[]>([]);
    const [publishingSharedLibrary, setPublishingSharedLibrary] = useState(false);

    // Community Catalog Browse State
    const [communityLibraries, setCommunityLibraries] = useState<any[]>([]);
    const [libSubTab, setLibSubTab] = useState<'active' | 'browse' | 'shared'>('active');
    const [communitySearchQuery, setCommunitySearchQuery] = useState('');
    const [fetchingCommunityDir, setFetchingCommunityDir] = useState(false);

    // Load custom icons from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('collabpro_custom_icons');
            if (saved) {
                setCustomIcons(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Error loading custom icons:", e);
        }
    }, []);

    // Self-Healing Session Restorer for Library Icons (Standard, AWS, Custom)
    useEffect(() => {
        if (!excalidrawAPI || !fileData?.whiteboard) return;

        const restoreLibraryIcons = async () => {
            try {
                const elements = excalidrawAPI.getSceneElements() || [];
                const currentFiles = excalidrawAPI.getFiles() || {};
                
                // Find all image elements with registered library prefixes that aren't loaded in the Excalidraw session
                const unregisteredImageElements = elements.filter((el: any) => 
                    el.type === "image" && 
                    el.fileId && 
                    (el.fileId.startsWith("aws__") || el.fileId.startsWith("std__") || el.fileId.startsWith("custom__")) &&
                    !currentFiles[el.fileId]
                );

                if (unregisteredImageElements.length === 0) return;

                const filesToRegister: any[] = [];
                for (const el of unregisteredImageElements) {
                    let iconUrl: string | undefined;

                    if (el.fileId.startsWith("aws__")) {
                        const icon = AWS_ICONS.find(i => i.id === el.fileId);
                        if (icon) iconUrl = icon.url;
                    } else if (el.fileId.startsWith("std__")) {
                        const icon = SYSTEM_NODES.find(i => i.id === el.fileId);
                        if (icon) iconUrl = icon.url;
                    } else if (el.fileId.startsWith("custom__")) {
                        const icon = customIcons.find(i => i.id === el.fileId);
                        if (icon) iconUrl = icon.url;
                    }

                    if (iconUrl) {
                        try {
                            const base64 = await fetchSVGAsBase64(iconUrl);
                            filesToRegister.push({
                                id: el.fileId,
                                dataURL: base64,
                                mimeType: "image/svg+xml"
                            });
                        } catch (err) {
                            console.error(`Failed to restore library icon ${el.fileId}:`, err);
                        }
                    }
                }

                if (filesToRegister.length > 0) {
                    await excalidrawAPI.addFiles(filesToRegister);
                    excalidrawAPI.updateScene({
                        elements: excalidrawAPI.getSceneElements()
                    });
                }
            } catch (e) {
                console.error("Error in self-healing library icons restorer:", e);
            }
        };

        restoreLibraryIcons();
    }, [excalidrawAPI, fileData?.whiteboard, customIcons]);

    const handleDragStart = (e: React.DragEvent, icon: any, type: 'standard' | 'aws' | 'custom') => {
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

            const finalIcon = {
                ...icon,
                id: icon.id || `std__${icon.type || Math.random().toString(36).substr(2, 9)}`
            };
            handleInsertIconNode(finalIcon, x, y);
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
            // If server data matches what we last saved/rendered, do nothing (feedback loop protection)
            if (fileData.whiteboard === lastSavedDataRef.current) {
                return;
            }
            
            const serverElements = decodeCrdtState(fileData.whiteboard, []);
            
            // Only overwrite if we are not currently drawing/saving (idle)
            if (saveTimeoutRef.current === null && !saveTimeoutRef.current) {
                excalidrawAPI.updateScene({
                    elements: serverElements
                });
                lastSavedDataRef.current = fileData.whiteboard;
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
        const crdtStr = encodeCrdtState(whiteBoardData);
        lastSavedDataRef.current = crdtStr;
        updateWhiteboard({
            _id:fileId,
            whiteboard:crdtStr
        }).then(resp=>{
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 2000);
        }).catch(() => {
            setSavingStatus('idle');
        });
    }

    const handleCanvasChange = (excalidrawElements: any) => {
        setWhiteBoardData(excalidrawElements);
        
        const currentCrdtStr = encodeCrdtState(excalidrawElements);
        // Avoid auto-saving if elements didn't change (e.g. on simple pan/zoom view changes)
        if (currentCrdtStr === lastSavedDataRef.current || !excalidrawElements || excalidrawElements.length === 0) {
            return;
        }

        setSavingStatus('saving');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            updateWhiteboard({
                _id: fileId,
                whiteboard: currentCrdtStr
            }).then(() => {
                lastSavedDataRef.current = currentCrdtStr;
                setSavingStatus('saved');
                setTimeout(() => setSavingStatus('idle'), 2000);
                saveTimeoutRef.current = null;
            }).catch(() => {
                setSavingStatus('idle');
            });
        }, 1500);
    };

    // Unified Premium Insertion Logic for Library Icons (Standard, AWS, Custom)
    // Ensures a bounding rounded box wraps the logo and label so it supports line connectors
    const handleInsertIconNode = async (icon: { label: string; url: string; id: string; stroke?: string; fill?: string }, customX?: number, customY?: number) => {
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
                const scrollX = excalidrawAPI.getAppState()?.scrollX || 0;
                const scrollY = excalidrawAPI.getAppState()?.scrollY || 0;
                const zoomValue = excalidrawAPI.getAppState()?.zoom?.value || 1;
                
                x = -scrollX + 150 / zoomValue;
                y = -scrollY + 120 / zoomValue;
            }

            const boxId = `box_${Math.random().toString(36).substr(2, 9)}`;
            const imageId = `img_${Math.random().toString(36).substr(2, 9)}`;
            const textId = `text_${Math.random().toString(36).substr(2, 9)}`;
            const groupId = `group_${Math.random().toString(36).substr(2, 9)}`;

            const groupIds = (includeCard || includeLabel) ? [groupId] : [];
            const newElements = [...currentElements];

            let imageX = x;
            let imageY = y;
            let imageW = 60;
            let imageH = 60;

            if (includeCard) {
                imageW = 50;
                imageH = 50;
                imageX = x + 25;
                imageY = y + 12;

                const boxElement = {
                    type: "rectangle",
                    version: 1,
                    versionNonce: Math.floor(Math.random() * 1000000),
                    isDeleted: false,
                    id: boxId,
                    x: x,
                    y: y,
                    width: 100,
                    height: includeLabel ? 105 : 74,
                    strokeColor: icon.stroke || "#cbd5e1",
                    backgroundColor: icon.fill || "#ffffff",
                    fillStyle: "solid",
                    strokeWidth: 1.5,
                    strokeStyle: "solid",
                    roughness: 0,
                    opacity: 100,
                    angle: 0,
                    strokeSharpness: "round",
                    boundElements: null,
                    updated: Date.now(),
                    link: null,
                    locked: false,
                    groupIds: groupIds,
                    seed: Math.floor(Math.random() * 1000000),
                    frameId: null,
                    roundness: { type: 3 }
                };
                newElements.push(boxElement);
            }

            const imageElement = {
                type: "image",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: imageId,
                x: imageX,
                y: imageY,
                width: imageW,
                height: imageH,
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
                groupIds: groupIds,
                frameId: null,
                roundness: null,
                seed: Math.floor(Math.random() * 1000000),
                updated: Date.now(),
                link: null
            };
            newElements.push(imageElement);

            if (includeLabel) {
                let textX = x + 5;
                let textY = y + 74;
                let textW = 90;

                if (!includeCard) {
                    textX = x - 20;
                    textY = y + 66;
                    textW = 100;
                }

                const textElement = {
                    type: "text",
                    version: 1,
                    versionNonce: Math.floor(Math.random() * 1000000),
                    isDeleted: false,
                    id: textId,
                    x: textX,
                    y: textY,
                    width: textW,
                    height: 20,
                    strokeColor: "#334155",
                    backgroundColor: "transparent",
                    fillStyle: "solid",
                    strokeWidth: 1,
                    strokeStyle: "solid",
                    roughness: 0,
                    opacity: 100,
                    angle: 0,
                    text: icon.label,
                    fontSize: 10,
                    fontFamily: 1,
                    textAlign: "center",
                    verticalAlign: "middle",
                    originalText: icon.label,
                    updated: Date.now(),
                    link: null,
                    locked: false,
                    groupIds: groupIds,
                    frameId: null,
                    roundness: null,
                    seed: Math.floor(Math.random() * 1000000),
                    baseline: 13,
                    lineHeight: 1.25,
                    boundElements: null
                };
                newElements.push(textElement);
            }

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
            console.error("Error inserting icon:", err);
            toast.error("Failed to insert icon.");
        } finally {
            setLoadingIcon(null);
        }
    };

    // Add Custom Icon Handler
    const handleAddCustomIcon = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customName || !customUrl) {
            toast.error("Please provide both name and icon URL.");
            return;
        }

        const newIcon = {
            id: `custom__${Math.random().toString(36).substr(2, 9)}`,
            name: customName.replace(/\s+/g, ''),
            label: customName,
            url: customUrl,
            category: customCategory.trim() || 'Custom'
        };

        const updated = [...customIcons, newIcon];
        setCustomIcons(updated);
        localStorage.setItem('collabpro_custom_icons', JSON.stringify(updated));
        
        setCustomName('');
        setCustomUrl('');
        setCustomCategory('');
        setIsAddFormOpen(false);
        toast.success(`Added ${customName} to your custom library!`);
    };

    // Delete Custom Icon Handler
    const handleDeleteCustomIcon = (id: string, name: string) => {
        const updated = customIcons.filter(icon => icon.id !== id);
        setCustomIcons(updated);
        localStorage.setItem('collabpro_custom_icons', JSON.stringify(updated));
        toast.success(`Removed ${name} from your custom library.`);
    };

    // Load custom library URLs from localStorage on mount and fetch community directory
    useEffect(() => {
        try {
            const saved = localStorage.getItem('collabpro_custom_library_urls');
            if (saved) {
                setCustomLibrariesList(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Error loading custom library urls:", e);
        }

        const fetchCommunityDirectory = async () => {
            try {
                // Try reading from cache first for instant load
                const cached = localStorage.getItem('collabpro_community_libraries_cache');
                if (cached) {
                    setCommunityLibraries(JSON.parse(cached));
                }

                setFetchingCommunityDir(true);
                const response = await fetch("https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries.json");
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data)) {
                        setCommunityLibraries(data);
                        localStorage.setItem('collabpro_community_libraries_cache', JSON.stringify(data));
                    }
                }
            } catch (err) {
                console.error("Failed to fetch community libraries index:", err);
            } finally {
                setFetchingCommunityDir(false);
            }
        };

        fetchCommunityDirectory();
    }, []);

    // Ensure selected library is loaded
    useEffect(() => {
        if (activeTab !== 'libraries') return;
        
        const isLoaded = loadedLibraries.some(lib => lib.id === selectedLibraryId);
        if (isLoaded) return;

        const curated = CURATED_LIBRARIES.find(lib => lib.id === selectedLibraryId);
        if (curated) {
            fetchAndLoadLibrary(curated.url, curated.id, curated.name, curated.description, curated.author);
            return;
        }

        const foundCustom = customLibrariesList.find(lib => lib.id === selectedLibraryId);
        if (foundCustom) {
            fetchAndLoadLibrary(foundCustom.url, foundCustom.id, foundCustom.name, foundCustom.description, foundCustom.author);
        }
    }, [selectedLibraryId, activeTab, customLibrariesList, loadedLibraries]);

    const fetchAndLoadLibrary = async (url: string, id: string, name: string, description: string, author: string) => {
        setLoadingLibrary(id);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch library file");
            const json = await response.json();
            
            const parsedItems = json.library 
                ? json.library.map((elements: any[], index: number) => ({ elements, id: index }))
                : (json.libraryItems || []).map((item: any, index: number) => ({ elements: item.elements, id: item.id || index }));

            const libData = {
                id,
                name,
                description,
                items: parsedItems,
                url,
                author,
                itemNames: json.itemNames
            };

            setLoadedLibraries(prev => {
                const filtered = prev.filter(l => l.id !== id);
                return [...filtered, libData];
            });
            return libData;
        } catch (err) {
            console.error(err);
            toast.error(`Failed to load library: ${name}`);
            return null;
        } finally {
            setLoadingLibrary(null);
        }
    };

    const handleAddCustomLibraryUrl = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customLibraryUrl) return;

        let cleanUrl = customLibraryUrl.trim();
        let urlName = "Custom Library";
        try {
            const parts = cleanUrl.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart) {
                urlName = lastPart.replace('.excalidrawlib', '').replace(/-/g, ' ');
                urlName = urlName.charAt(0).toUpperCase() + urlName.slice(1);
            }
        } catch (e) {}

        const id = `custom_url_${Math.random().toString(36).substr(2, 9)}`;
        const description = "Imported from custom URL";
        const author = "External";

        const success = await fetchAndLoadLibrary(cleanUrl, id, urlName, description, author);
        if (success) {
            const newEntry = { id, name: urlName, url: cleanUrl, description, author };
            const updated = [...customLibrariesList, newEntry];
            setCustomLibrariesList(updated);
            localStorage.setItem('collabpro_custom_library_urls', JSON.stringify(updated));
            setSelectedLibraryId(id);
            setCustomLibraryUrl('');
            setIsAddLibFormOpen(false);
            toast.success(`Successfully imported and saved ${urlName}!`);
        }
    };

    const handleInstallCommunityLibrary = async (item: any) => {
        const url = `https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/${item.source}`;
        const id = `community_${item.id}`;
        
        if (customLibrariesList.some(lib => lib.id === id)) {
            toast.error(`${item.name} is already installed!`);
            return;
        }

        const success = await fetchAndLoadLibrary(url, id, item.name, item.description, item.authors.map((a: any) => a.name).join(', '));
        if (success) {
            const newEntry = {
                id,
                name: item.name,
                url,
                description: item.description,
                author: item.authors.map((a: any) => a.name).join(', ')
            };
            const updated = [...customLibrariesList, newEntry];
            setCustomLibrariesList(updated);
            localStorage.setItem('collabpro_custom_library_urls', JSON.stringify(updated));
            setSelectedLibraryId(id);
            setLibSubTab('active');
            toast.success(`Successfully installed community library: ${item.name}!`);
        }
    };

    const handleDeleteCustomLibraryUrl = (id: string, name: string) => {
        const updated = customLibrariesList.filter(l => l.id !== id);
        setCustomLibrariesList(updated);
        localStorage.setItem('collabpro_custom_library_urls', JSON.stringify(updated));
        setLoadedLibraries(prev => prev.filter(l => l.id !== id));
        if (selectedLibraryId === id) {
            setSelectedLibraryId('software-architecture');
        }
        toast.success(`Removed library "${name}"`);
    };

    useEffect(() => {
        if (!Array.isArray(sharedLibraryItems)) return;

        const parsedSharedLibraries = sharedLibraryItems.reduce((acc: any[], item: any) => {
            try {
                const parsed = JSON.parse(item.payload || "{}");
                const parsedItems = parsed.library
                    ? parsed.library.map((elements: any[], index: number) => ({ elements, id: index }))
                    : (parsed.libraryItems || []).map((entry: any, index: number) => ({
                        elements: entry.elements,
                        id: entry.id || index
                    }));

                if (!parsedItems.length) return acc;

                acc.push({
                    id: `shared_${item.id}`,
                    name: item.name,
                    description: item.description || "Shared team library",
                    items: parsedItems,
                    url: item.sourceUrl || "shared",
                    author: item.author || "Team",
                    itemNames: parsed.itemNames
                });
            } catch (err) {
                console.error("Failed to parse shared library payload:", err);
            }
            return acc;
        }, []);

        setLoadedLibraries(prev => {
            const withoutShared = prev.filter(lib => !String(lib.id).startsWith('shared_'));
            return [...withoutShared, ...parsedSharedLibraries];
        });
    }, [sharedLibraryItems]);

    const handlePublishToSharedCatalog = async () => {
        if (!fileData?.teamId) {
            toast.error("Team context is missing for shared library publishing.");
            return;
        }

        const currentLib = loadedLibraries.find(l => l.id === selectedLibraryId);
        if (!currentLib?.items?.length) {
            toast.error("Load a library before publishing to shared catalog.");
            return;
        }

        setPublishingSharedLibrary(true);
        try {
            const payload = JSON.stringify({
                type: "excalidrawlib",
                libraryItems: currentLib.items.map((item: any, index: number) => ({
                    id: item.id || index,
                    elements: item.elements
                })),
                itemNames: currentLib.itemNames || []
            });

            const sharedId = currentLib.id?.startsWith('shared_')
                ? currentLib.id.replace('shared_', '')
                : undefined;

            const saved = await upsertSharedLibraryItem({
                id: sharedId,
                teamId: fileData.teamId,
                name: currentLib.name,
                description: currentLib.description || "Shared team library",
                sourceUrl: currentLib.url || "",
                author: currentLib.author || "Team",
                payload
            });

            if (saved?.id) {
                setSelectedLibraryId(`shared_${saved.id}`);
            }
            toast.success(`Published "${currentLib.name}" to your shared team catalog.`);
        } catch (err) {
            console.error(err);
            toast.error("Failed to publish shared library.");
        } finally {
            setPublishingSharedLibrary(false);
        }
    };

    const handleLocalLibraryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (json.type !== "excalidrawlib") {
                    toast.error("Invalid library file. Must be an Excalidraw library (.excalidrawlib)");
                    return;
                }
                const parsedItems = json.library 
                    ? json.library.map((elements: any[], index: number) => ({ elements, id: index }))
                    : (json.libraryItems || []).map((item: any, index: number) => ({ elements: item.elements, id: item.id || index }));
                
                const newLib = {
                    id: `uploaded_${Date.now()}`,
                    name: file.name.replace(".excalidrawlib", ""),
                    description: `Uploaded from local computer (${parsedItems.length} items)`,
                    items: parsedItems,
                    url: "local",
                    author: "Local",
                    itemNames: json.itemNames
                };

                setLoadedLibraries(prev => [newLib, ...prev]);
                setSelectedLibraryId(newLib.id);
                setIsAddLibFormOpen(false);
                toast.success(`Successfully loaded ${file.name}!`);
            } catch (err) {
                console.error(err);
                toast.error("Failed to parse the library file.");
            }
        };
        reader.readAsText(file);
    };

    // Unified insertion function for compound native Excalidraw shapes
    const insertLibraryElements = (elements: any[], customX?: number, customY?: number) => {
        if (!excalidrawAPI) {
            toast.error("Excalidraw API not loaded yet.");
            return;
        }

        try {
            // 1. Calculate bounding box of the imported elements
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            elements.forEach((el: any) => {
                const x = el.x;
                const y = el.y;
                const w = el.width || 0;
                const h = el.height || 0;
                if (x !== undefined && y !== undefined) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x + w > maxX) maxX = x + w;
                    if (y + h > maxY) maxY = y + h;
                }
            });

            if (minX === Infinity) {
                minX = 0; minY = 0; maxX = 100; maxY = 100;
            }

            const groupWidth = maxX - minX;
            const groupHeight = maxY - minY;
            const groupCenterX = minX + groupWidth / 2;
            const groupCenterY = minY + groupHeight / 2;

            // 2. Determine target center position
            let targetX = 0;
            let targetY = 0;
            if (customX !== undefined && customY !== undefined) {
                targetX = customX;
                targetY = customY;
            } else {
                const scrollX = excalidrawAPI.getAppState()?.scrollX || 0;
                const scrollY = excalidrawAPI.getAppState()?.scrollY || 0;
                const zoomValue = excalidrawAPI.getAppState()?.zoom?.value || 1;
                
                targetX = -scrollX + 250 / zoomValue;
                targetY = -scrollY + 200 / zoomValue;
            }

            const offsetX = targetX - groupCenterX;
            const offsetY = targetY - groupCenterY;

            // 3. Create fresh, deep-copied elements with unique IDs to prevent duplicates
            const groupId = `lib_group_${Math.random().toString(36).substr(2, 9)}`;
            const idMap: { [key: string]: string } = {};

            elements.forEach((el: any) => {
                idMap[el.id] = `lib_el_${Math.random().toString(36).substr(2, 9)}`;
            });

            const processedElements = elements.map((el: any) => {
                const cloned = JSON.parse(JSON.stringify(el));
                cloned.id = idMap[el.id] || cloned.id;
                cloned.x = cloned.x + offsetX;
                cloned.y = cloned.y + offsetY;
                
                const existingGroups = cloned.groupIds || [];
                cloned.groupIds = [...existingGroups, groupId];
                
                if (cloned.boundElements) {
                    cloned.boundElements = cloned.boundElements.map((be: any) => ({
                        ...be,
                        id: idMap[be.id] || be.id
                    }));
                }

                if (cloned.boundElementIds) {
                    cloned.boundElementIds = cloned.boundElementIds.map((id: string) => idMap[id] || id);
                }

                if (cloned.startBinding) {
                    cloned.startBinding.elementId = idMap[cloned.startBinding.elementId] || cloned.startBinding.elementId;
                }
                if (cloned.endBinding) {
                    cloned.endBinding.elementId = idMap[cloned.endBinding.elementId] || cloned.endBinding.elementId;
                }

                cloned.seed = Math.floor(Math.random() * 1000000);
                cloned.version = cloned.version + 1;
                cloned.versionNonce = Math.floor(Math.random() * 1000000);
                cloned.updated = Date.now();

                return cloned;
            });

            const currentElements = excalidrawAPI.getSceneElements() || [];
            const newElements = [...currentElements, ...processedElements];
            
            excalidrawAPI.updateScene({
                elements: newElements
            });

            handleCanvasChange(newElements);
            toast.success("Inserted library asset!");
        } catch (err) {
            console.error("Error inserting library elements:", err);
            toast.error("Failed to insert library shape.");
        }
    };

    // Filters for AWS tab
    const filteredAWSIcons = AWS_ICONS.filter(icon => {
        const matchesCategory = selectedCategory === 'all' || icon.category === selectedCategory;
        const matchesQuery = icon.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             icon.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesQuery;
    });

    const displayedAWSIcons = filteredAWSIcons.slice(0, 100);

    // Filters for Custom tab
    const customCategories = ['all', ...Array.from(new Set(customIcons.map(icon => icon.category)))];
    
    const filteredCustomIcons = customIcons.filter(icon => {
        const matchesCategory = selectedCustomCategory === 'all' || icon.category === selectedCustomCategory;
        const matchesQuery = icon.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             icon.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesQuery;
    });

    // Filters for Standard tab
    const filteredSystemNodes = SYSTEM_NODES.filter(node => {
        return node.label.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
    <div 
      className="flex w-full h-full relative overflow-hidden"
      style={{ height: "calc(100vh - 80px)" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex-1 h-full min-w-0 relative">
        {fileData && (
          <Excalidraw 
            theme="light"
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            initialData={{
                elements: fileData?.whiteboard ? decodeCrdtState(fileData.whiteboard, []) : []
            }}
            onChange={handleCanvasChange}
            UIOptions={{
                canvasActions: {
                    saveToActiveFile: false,
                    loadScene: false,
                    export: false,
                    toggleTheme: false
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
          </Excalidraw>
        )}

        {/* Floating Button to open sidebar if collapsed */}
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#6965db] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 shadow-lg hover:shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4 text-[#6965db]" />
            <span>Canvas Elements</span>
          </button>
        )}
      </div>

      {/* Slide-in right sidebar sibling */}
      <div 
        className={`h-full shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-all duration-300 ease-in-out select-none z-40 ${
          isSidebarOpen ? 'w-[320px] opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-950 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-lg bg-[#6965db]/10 flex items-center justify-center">
              <Sparkles className="h-3 w-3 text-[#6965db]" />
            </div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Canvas Elements
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Switcher Grid */}
        <div className="grid grid-cols-4 gap-1 p-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/60 shrink-0">
          {[
            { id: 'standard', label: 'Standard' },
            { id: 'aws', label: 'AWS' },
            { id: 'custom', label: 'Custom' },
            { id: 'libraries', label: 'Library' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as any);
                setSearchQuery('');
              }}
              className={`py-1.5 rounded-lg text-[10px] font-bold text-center transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-[#6965db] dark:text-[#8572e3] shadow-sm border border-slate-200/50 dark:border-slate-700/50'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        <div className="flex-1 min-h-0 bg-white dark:bg-slate-900 flex flex-col">
          {activeTab === 'standard' && (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 min-h-0">
              {/* Search */}
              <div className="px-3 pt-3 pb-1 shrink-0 bg-white dark:bg-slate-900">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search standard nodes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 focus:border-[#6965db]/80 text-slate-800 dark:text-slate-200 font-medium"
                  />
                  {searchQuery && (
                    <button 
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Placement Style */}
              <div className="px-3 py-1.5 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-4 text-[10px] select-none font-bold">
                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider">Placement Style</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeCard}
                      onChange={(e) => setIncludeCard(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Card Frame</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeLabel}
                      onChange={(e) => setIncludeLabel(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Name Label</span>
                  </label>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 min-h-0 bg-white dark:bg-slate-900">
                <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5">
                  {filteredSystemNodes.map((node) => (
                    <button
                      key={node.id}
                      disabled={loadingIcon !== null}
                      onClick={() => handleInsertIconNode(node)}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, node, 'standard')}
                      className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-[#6965db]/5 dark:hover:bg-[#6965db]/10 border border-slate-100 dark:border-slate-800 hover:border-[#6965db]/30 dark:hover:border-[#6965db]/50 transition-all active:scale-95 group cursor-grab active:cursor-grabbing min-h-[76px]"
                      title={`Drag or Click to insert ${node.label}`}
                    >
                      {loadingIcon === node.id ? (
                        <Loader2 className="h-4 w-4 text-[#6965db] animate-spin" />
                      ) : (
                        <img 
                          src={node.url} 
                          alt={node.label} 
                          className="w-8 h-8 object-contain group-hover:scale-110 transition-transform dark:brightness-90" 
                        />
                      )}
                      <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 mt-1.5 truncate max-w-full text-center group-hover:text-[#6965db] dark:group-hover:text-[#8572e3]">
                        {node.label}
                      </span>
                    </button>
                  ))}
                </div>
                {filteredSystemNodes.length === 0 && (
                  <div className="text-center p-4 text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase">
                    No matching nodes found
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'aws' && (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 min-h-0">
              {/* Search */}
              <div className="px-3 pt-3 pb-1 shrink-0 bg-white dark:bg-slate-900">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search 800+ AWS Icons..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 focus:border-[#6965db]/80 text-slate-800 dark:text-slate-200 font-medium"
                  />
                  {searchQuery && (
                    <button 
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Placement Style */}
              <div className="px-3 py-1.5 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-4 text-[10px] select-none font-bold">
                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider">Placement Style</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeCard}
                      onChange={(e) => setIncludeCard(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Card Frame</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeLabel}
                      onChange={(e) => setIncludeLabel(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Name Label</span>
                  </label>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                {/* AWS Category Tabs */}
                <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-thin select-none shrink-0">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'architecture-service', label: 'Service' },
                    { id: 'resource', label: 'Resource' },
                    { id: 'architecture-group', label: 'Group' },
                    { id: 'category', label: 'Category' }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border shrink-0 transition-all ${selectedCategory === cat.id ? 'bg-[#6965db] text-white border-[#6965db]' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* AWS Icons Grid */}
                <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-3 gap-1.5 min-h-0 mt-1">
                  {displayedAWSIcons.map((icon) => (
                    <button
                      key={icon.id}
                      disabled={loadingIcon !== null}
                      onClick={() => handleInsertIconNode(icon)}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, icon, 'aws')}
                      className={`flex flex-col items-center justify-between p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-[#6965db]/5 dark:hover:bg-[#6965db]/10 hover:border-[#6965db]/30 dark:hover:border-[#6965db]/50 transition-all group active:scale-95 h-[76px] relative cursor-grab active:cursor-grabbing ${loadingIcon === icon.id ? 'opacity-70 border-[#6965db] bg-[#6965db]/10' : ''}`}
                      title={`Drag or Click to insert ${icon.label}`}
                    >
                      {loadingIcon === icon.id ? (
                        <div className="flex-1 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 text-[#6965db] animate-spin" />
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center p-0.5">
                          <img 
                            src={icon.url} 
                            alt={icon.label} 
                            className="w-8 h-8 object-contain group-hover:scale-110 transition-transform dark:brightness-90"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <span className="text-[8px] leading-tight font-semibold text-slate-500 dark:text-slate-400 text-center line-clamp-2 w-full mt-1 group-hover:text-[#6965db] dark:group-hover:text-[#8572e3]">
                        {icon.label.replace(/^Amazon\s+|AWS\s+/, '')}
                      </span>
                    </button>
                  ))}
                </div>
                
                {/* AWS Status Footer */}
                <div className="text-[8px] text-slate-400 dark:text-slate-500 font-semibold px-1 text-center mt-1 border-t border-slate-100 dark:border-slate-800 pt-1.5 shrink-0">
                  {filteredAWSIcons.length > 100 
                    ? `Showing first 100 of ${filteredAWSIcons.length} matching icons` 
                    : `Found ${filteredAWSIcons.length} matching icons`}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 min-h-0">
              {/* Search */}
              <div className="px-3 pt-3 pb-1 shrink-0 bg-white dark:bg-slate-900">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search custom library..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 focus:border-[#6965db]/80 text-slate-800 dark:text-slate-200 font-medium"
                  />
                  {searchQuery && (
                    <button 
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Placement Style */}
              <div className="px-3 py-1.5 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-4 text-[10px] select-none font-bold">
                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider">Placement Style</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeCard}
                      onChange={(e) => setIncludeCard(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Card Frame</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-[#6965db] dark:hover:text-[#8572e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={includeLabel}
                      onChange={(e) => setIncludeLabel(e.target.checked)}
                      className="rounded text-[#6965db] focus:ring-[#6965db]/50 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-3 w-3 cursor-pointer"
                    />
                    <span>Name Label</span>
                  </label>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                {/* Form to Add New Custom Icon */}
                {isAddFormOpen ? (
                  <form onSubmit={handleAddCustomIcon} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2 mb-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider">New Custom Icon</span>
                      <button 
                        type="button" 
                        onClick={() => setIsAddFormOpen(false)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">Icon Name</label>
                      <input
                        type="text"
                        placeholder="e.g. NextJS, Redis"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6965db] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-medium"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">SVG / Image URL</label>
                      <input
                        type="url"
                        placeholder="https://example.com/logo.svg"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6965db] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-medium"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">Category (Optional)</label>
                      <input
                        type="text"
                        placeholder="Database, Cache, Frontend, etc."
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6965db] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-medium"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-[#6965db] hover:bg-[#5b57c6] text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                    >
                      Save Custom Icon
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddFormOpen(true)}
                    className="w-full py-2 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-400 font-bold transition-all flex items-center justify-center gap-1 shrink-0 mb-2 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-[#6965db]" /> Add Custom Icon
                  </button>
                )}

                {/* Custom Category Tabs */}
                {customCategories.length > 2 && (
                  <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-thin select-none shrink-0 mb-1">
                    {customCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCustomCategory(cat)}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border shrink-0 transition-all ${selectedCustomCategory === cat ? 'bg-[#6965db] text-white border-[#6965db]' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Custom Icons Grid */}
                {filteredCustomIcons.length > 0 ? (
                  <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-3 gap-1.5 min-h-0">
                    {filteredCustomIcons.map((icon) => (
                      <div
                        key={icon.id}
                        className={`flex flex-col items-center justify-between p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-[#6965db]/5 dark:hover:bg-[#6965db]/10 hover:border-[#6965db]/30 dark:hover:border-[#6965db]/50 transition-all group h-[76px] relative cursor-grab active:cursor-grabbing ${loadingIcon === icon.id ? 'opacity-70' : ''}`}
                        title={`Drag or Click to insert ${icon.label}`}
                      >
                        {/* Drag / Click transparent spacer layer */}
                        <button
                          type="button"
                          onClick={() => handleInsertIconNode(icon)}
                          className="absolute inset-0 z-0 rounded-xl cursor-pointer"
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, icon, 'custom')}
                        />
                        
                        <div className="flex-1 flex items-center justify-center p-0.5 z-10 pointer-events-none">
                          {loadingIcon === icon.id ? (
                            <Loader2 className="h-4 w-4 text-[#6965db] animate-spin" />
                          ) : (
                            <img 
                              src={icon.url} 
                              alt={icon.label} 
                              className="w-8 h-8 object-contain group-hover:scale-110 transition-transform dark:brightness-90"
                              onError={(e) => {
                                e.currentTarget.src = "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/resource/User.svg";
                              }}
                              loading="lazy"
                            />
                          )}
                        </div>
                        <div className="w-full flex items-center justify-between gap-1 z-10 px-0.5 mt-1">
                          <span className="text-[8px] leading-tight font-semibold text-slate-500 dark:text-slate-400 truncate group-hover:text-[#6965db] dark:group-hover:text-[#8572e3] flex-1 select-none pointer-events-none">
                            {icon.label}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomIcon(icon.id, icon.label);
                            }}
                            className="text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer"
                            title={`Delete ${icon.label}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-800/10">
                    <Cloud className="h-8 w-8 text-slate-300 dark:text-slate-600 animate-pulse mb-1.5" />
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Custom Library Empty</span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal max-w-[140px]">
                      Add customized database, API, or frontend logos using the form above!
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'libraries' && (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 min-h-0">
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                {/* Sleek Sub-Tab switcher: Active vs Community Browse */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl text-[10px] font-bold select-none shrink-0 mb-2 border border-slate-200/40 dark:border-slate-700/40">
                  <button
                    type="button"
                    onClick={() => setLibSubTab('active')}
                    className={`flex-1 py-1 rounded-lg transition-all text-center cursor-pointer ${libSubTab === 'active' ? 'bg-white dark:bg-slate-700 text-[#6965db] dark:text-[#8572e3] shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
                  >
                    Active Libraries
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibSubTab('browse')}
                    className={`flex-1 py-1 rounded-lg transition-all text-center cursor-pointer ${libSubTab === 'browse' ? 'bg-white dark:bg-slate-700 text-[#6965db] dark:text-[#8572e3] shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
                  >
                    Curated Packs
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibSubTab('shared')}
                    className={`flex-1 py-1 rounded-lg transition-all text-center cursor-pointer ${libSubTab === 'shared' ? 'bg-white dark:bg-slate-700 text-[#6965db] dark:text-[#8572e3] shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
                  >
                    Shared Catalog
                  </button>
                </div>

                {libSubTab === 'active' ? (
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    {/* Select Library Dropdown & Custom Importer Form */}
                    <div className="space-y-1.5 shrink-0">
                      <div className="flex items-center justify-between">
                        <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Select Library</label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={publishingSharedLibrary}
                            onClick={handlePublishToSharedCatalog}
                            className="text-[9px] font-extrabold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-0.5 cursor-pointer disabled:opacity-60"
                          >
                            {publishingSharedLibrary ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Cloud className="h-2.5 w-2.5" />}
                            Publish
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsAddLibFormOpen(!isAddLibFormOpen)}
                            className="text-[9px] font-extrabold text-[#6965db] hover:text-[#5b57c6] dark:text-[#8572e3] dark:hover:text-[#8572e3]/80 flex items-center gap-0.5 cursor-pointer"
                          >
                            <Plus className="h-2.5 w-2.5" /> Import Custom
                          </button>
                        </div>
                      </div>
                      <select
                        value={selectedLibraryId}
                        onChange={(e) => setSelectedLibraryId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                      >
                        <optgroup label="Curated Technical Libraries" className="dark:bg-slate-900">
                          {CURATED_LIBRARIES.map(lib => (
                            <option key={lib.id} value={lib.id}>{lib.name}</option>
                          ))}
                        </optgroup>
                        {customLibrariesList.length > 0 && (
                          <optgroup label="Imported & Community Libraries" className="dark:bg-slate-900">
                            {customLibrariesList.map(lib => (
                              <option key={lib.id} value={lib.id}>{lib.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {Array.isArray(sharedLibraryItems) && sharedLibraryItems.length > 0 && (
                          <optgroup label="Shared Team Catalog" className="dark:bg-slate-900">
                            {sharedLibraryItems.map((lib: any) => (
                              <option key={lib.id} value={`shared_${lib.id}`}>{lib.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {loadedLibraries.filter(l => l.id.startsWith('uploaded_')).length > 0 && (
                          <optgroup label="Locally Uploaded Files" className="dark:bg-slate-900">
                            {loadedLibraries.filter(l => l.id.startsWith('uploaded_')).map(lib => (
                              <option key={lib.id} value={lib.id}>{lib.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* Import Custom Library URL or upload local file form */}
                    {isAddLibFormOpen && (
                      <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2 shrink-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider">Import Library</span>
                          <button 
                            type="button" 
                            onClick={() => setIsAddLibFormOpen(false)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                        
                        {/* Option A: From Web URL */}
                        <form onSubmit={handleAddCustomLibraryUrl} className="space-y-1.5">
                          <label className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider block">Option 1: Raw .excalidrawlib URL</label>
                          <div className="flex gap-1">
                            <input
                              type="url"
                              placeholder="https://.../*.excalidrawlib"
                              value={customLibraryUrl}
                              onChange={(e) => setCustomLibraryUrl(e.target.value)}
                              className="flex-1 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6965db] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-medium"
                              required
                            />
                            <button
                              type="submit"
                              className="px-2.5 bg-[#6965db] hover:bg-[#5b57c6] text-white rounded-lg text-[10px] font-bold transition-all shrink-0 cursor-pointer"
                            >
                              Import
                            </button>
                          </div>
                        </form>

                        {/* Divider */}
                        <div className="relative flex py-1 items-center">
                          <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                          <span className="flex-shrink mx-2 text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase">or</span>
                          <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                        </div>

                        {/* Option B: Local File Upload */}
                        <div className="space-y-1.5">
                          <label className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider block">Option 2: Upload File</label>
                          <div className="relative">
                            <input
                              type="file"
                              accept=".excalidrawlib"
                              onChange={handleLocalLibraryUpload}
                              id="local-lib-file"
                              className="hidden"
                            />
                            <label
                              htmlFor="local-lib-file"
                              className="w-full py-1.5 bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-[10px] text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Upload className="h-3 w-3 text-[#6965db]" /> Choose .excalidrawlib file
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Library Shapes Search */}
                    <div className="relative shrink-0">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search active library shapes..."
                        value={librarySearchQuery}
                        onChange={(e) => setLibrarySearchQuery(e.target.value)}
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 focus:border-[#6965db]/80 text-slate-800 dark:text-slate-200 font-medium"
                      />
                      {librarySearchQuery && (
                        <button 
                          type="button"
                          onClick={() => setLibrarySearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Library Shapes List */}
                    {loadingLibrary === selectedLibraryId ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 animate-pulse">
                        <Loader2 className="h-6 w-6 text-[#6965db] animate-spin mb-2" />
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fetching Library Assets...</span>
                      </div>
                    ) : (() => {
                      const currentLib = loadedLibraries.find(l => l.id === selectedLibraryId);
                      if (!currentLib || !currentLib.items || currentLib.items.length === 0) {
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-800/10 mt-1">
                            <BookOpen className="h-8 w-8 text-slate-300 dark:text-slate-600 animate-pulse mb-1.5" />
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">No Assets Loaded</span>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal max-w-[150px]">
                              Select a library above or import one to see the software design assets.
                            </span>
                          </div>
                        );
                      }

                      // Filter items based on search query
                      const filteredItems = currentLib.items.filter((item: any, idx: number) => {
                        const name = getItemName(item.elements, idx, currentLib.itemNames).toLowerCase();
                        return name.includes(librarySearchQuery.toLowerCase());
                      });

                      return (
                        <div className="flex-1 overflow-y-auto pr-0.5 space-y-1.5 min-h-0">
                          <div className="text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider px-1 flex items-center justify-between shrink-0 mb-1">
                            <span className="truncate max-w-[170px]">{currentLib.description}</span>
                            {customLibrariesList.some(l => l.id === currentLib.id) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomLibraryUrl(currentLib.id, currentLib.name)}
                                className="text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 transition-colors uppercase font-black cursor-pointer"
                                title="Remove Library"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5">
                             {filteredItems.map((item: any, idx: number) => {
                               const name = getItemName(item.elements, idx, currentLib.itemNames);
                               const elementCount = item.elements.length;
                               
                               return (
                                 <button
                                   key={`${selectedLibraryId}_item_${idx}`}
                                   type="button"
                                   onClick={() => insertLibraryElements(item.elements)}
                                   className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-[#6965db]/5 dark:hover:bg-[#6965db]/10 border border-slate-100 dark:border-slate-800 hover:border-[#6965db]/30 dark:hover:border-[#6965db]/50 transition-all active:scale-95 group cursor-grab active:cursor-grabbing min-h-[76px]"
                                   title={`Click to insert ${name}`}
                                 >
                                   <div className="w-10 h-10 flex items-center justify-center text-[#6965db] dark:text-[#8572e3] transition-transform group-hover:scale-110">
                                     <LibraryItemPreview elements={item.elements} />
                                   </div>
                                   <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 mt-1.5 truncate max-w-full text-center group-hover:text-[#6965db] dark:group-hover:text-[#8572e3]">
                                     {name}
                                   </span>
                                 </button>
                               );
                             })}
                             {filteredItems.length === 0 && (
                               <div className="text-center p-4 text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase col-span-2">
                                 No matching shapes found
                               </div>
                             )}
                           </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : libSubTab === 'browse' ? (
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    {/* Community Directory Search Bar */}
                    <div className="relative shrink-0">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search 100+ community libraries..."
                        value={communitySearchQuery}
                        onChange={(e) => setCommunitySearchQuery(e.target.value)}
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6965db]/50 focus:border-[#6965db]/80 text-slate-800 dark:text-slate-200 font-medium"
                      />
                      {communitySearchQuery && (
                        <button 
                          type="button"
                          onClick={() => setCommunitySearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Community Directory List */}
                    {fetchingCommunityDir && communityLibraries.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 animate-pulse">
                        <Loader2 className="h-6 w-6 text-[#6965db] animate-spin mb-2" />
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Loading Directory Catalog...</span>
                      </div>
                    ) : (() => {
                      // Filter community libraries based on search query
                      const query = communitySearchQuery.toLowerCase();
                      const filteredCommunity = communityLibraries.filter(lib => 
                        lib.name.toLowerCase().includes(query) || 
                        lib.description.toLowerCase().includes(query)
                      );

                      return (
                        <div className="flex-1 overflow-y-auto pr-0.5 space-y-2 min-h-0">
                          <div className="text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider px-1 flex items-center justify-between shrink-0 mb-1">
                            <span>Available Libraries ({filteredCommunity.length})</span>
                            <span className="flex items-center gap-0.5 text-[7px] text-slate-400 dark:text-slate-500"><Globe className="h-2 w-2" /> Live Registry</span>
                          </div>

                          <div className="space-y-1.5">
                            {filteredCommunity.slice(0, 50).map((lib: any) => {
                              const authorName = lib.authors && lib.authors[0] ? lib.authors[0].name : "Unknown";
                              const installId = `community_${lib.id}`;
                              const isInstalled = customLibrariesList.some(cl => cl.id === installId);
                              const isCurated = CURATED_LIBRARIES.some(cl => cl.id === lib.id || cl.id === lib.name.toLowerCase().replace(/\s+/g, '-'));
                              const isAlreadyAvailable = isInstalled || isCurated;
                              
                              return (
                                <div
                                  key={lib.id}
                                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex flex-col gap-1.5 text-left hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                                >
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-800 dark:text-slate-300 flex items-center justify-between gap-1.5 leading-normal">
                                      <span className="truncate max-w-[150px]">{lib.name}</span>
                                      {isCurated && (
                                        <span className="px-1.5 py-0.5 bg-[#6965db]/10 text-[#6965db] rounded text-[7px] font-black uppercase shrink-0">
                                          Curated
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium leading-normal mt-0.5 line-clamp-2">
                                      {lib.description}
                                    </p>
                                    <div className="text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-1">
                                      by {authorName}
                                    </div>
                                  </div>

                                  <div className="flex justify-end pt-1 border-t border-slate-100/60 dark:border-slate-800/60 mt-0.5">
                                    {isAlreadyAvailable ? (
                                      <div className="flex items-center gap-1 text-[8px] font-black uppercase text-emerald-600 dark:text-emerald-400 select-none bg-emerald-50/50 dark:bg-emerald-950/20 px-2 py-1 rounded-lg border border-emerald-100 dark:border-emerald-900/50">
                                        <Check className="h-2.5 w-2.5" /> Installed
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={loadingLibrary !== null}
                                        onClick={() => handleInstallCommunityLibrary(lib)}
                                        className="px-2.5 py-1 bg-[#6965db] hover:bg-[#5b57c6] text-white rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        {loadingLibrary === installId ? (
                                          <>
                                            <Loader2 className="h-2.5 w-2.5 animate-spin" /> Installing...
                                          </>
                                        ) : (
                                          <>
                                            <Download className="h-2.5 w-2.5" /> Install
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            
                            {filteredCommunity.length > 50 && (
                              <div className="text-center py-2 text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase">
                                Showing first 50 results. Narrow search to find more.
                              </div>
                            )}

                            {filteredCommunity.length === 0 && (
                              <div className="text-center p-6 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-800/10">
                                <BookOpen className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-1.5 mx-auto animate-pulse" />
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1 block">No matches found</span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal max-w-[150px] mx-auto block text-center">
                                  Try searching for "gcp", "docker", "c4", or other system terms.
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    <div className="text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider px-1 flex items-center justify-between shrink-0 mb-1">
                      <span>Shared Team Libraries ({Array.isArray(sharedLibraryItems) ? sharedLibraryItems.length : 0})</span>
                      <span className="flex items-center gap-0.5 text-[7px] text-slate-400 dark:text-slate-500"><Cloud className="h-2 w-2" /> Syncing</span>
                    </div>
                    <div className="flex-1 overflow-y-auto pr-0.5 space-y-1.5 min-h-0">
                      {!Array.isArray(sharedLibraryItems) || sharedLibraryItems.length === 0 ? (
                        <div className="text-center p-6 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-800/10">
                          <BookOpen className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-1.5 mx-auto animate-pulse" />
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1 block">No shared libraries yet</span>
                          <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal max-w-[170px] mx-auto block text-center">
                            Open a library in Active Libraries and click Publish to share it with your workspace.
                          </span>
                        </div>
                      ) : (
                        sharedLibraryItems.map((lib: any) => (
                          <button
                            key={lib.id}
                            type="button"
                            onClick={() => {
                              setSelectedLibraryId(`shared_${lib.id}`);
                              setLibSubTab('active');
                            }}
                            className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors cursor-pointer"
                          >
                            <div className="text-[10px] font-bold text-slate-800 dark:text-slate-300 leading-normal truncate">{lib.name}</div>
                            <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium leading-normal mt-0.5 line-clamp-2">
                              {lib.description || "Shared team library"}
                            </p>
                            <div className="text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-1">
                              by {lib.author || "Team"}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Canvas