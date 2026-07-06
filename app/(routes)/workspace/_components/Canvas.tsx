import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
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

    const [activeTab, setActiveTab] = useState<'standard' | 'aws' | 'libraries' | 'custom'>('standard');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [loadingIcon, setLoadingIcon] = useState<string | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

    // Community Catalog Browse State
    const [communityLibraries, setCommunityLibraries] = useState<any[]>([]);
    const [libSubTab, setLibSubTab] = useState<'active' | 'browse'>('active');
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

            // 1. Bounding Rounded Rectangle (Card structure that enables excalidraw line/arrow connectors)
            const boxElement = {
                type: "rectangle",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: boxId,
                x: x,
                y: y,
                width: 100,
                height: 105,
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
                groupIds: [groupId],
                seed: Math.floor(Math.random() * 1000000),
                frameId: null,
                roundness: { type: 3 }
            };

            // 2. Centered SVG logo/image
            const imageElement = {
                type: "image",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: imageId,
                x: x + 25,
                y: y + 12,
                width: 50,
                height: 50,
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

            // 3. Crisp text label (gives a generous 12px margin beneath the logo)
            const textElement = {
                type: "text",
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                isDeleted: false,
                id: textId,
                x: x + 5,
                y: y + 74, // logo ends at y+12+50=y+62. This leaves a neat 12px gap.
                width: 90,
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
                groupIds: [groupId],
                frameId: null,
                roundness: null,
                seed: Math.floor(Math.random() * 1000000),
                baseline: 13,
                lineHeight: 1.25,
                boundElements: null
            };

            const newElements = [...currentElements, boxElement, imageElement, textElement];
            
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
          className="absolute top-4 right-4 z-[99] flex items-center gap-2 bg-white/95 backdrop-blur-md hover:bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60 shadow-xl pointer-events-auto transition-all active:scale-95 text-slate-800"
          title="Expand Panel"
        >
          <Cloud className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Canvas Elements</span>
          <ChevronLeft className="h-4 w-4 text-slate-400 ml-1" />
        </button>
      ) : (
        <div className="absolute top-4 right-4 z-[99] flex flex-col bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xl w-[290px] h-[460px] pointer-events-auto overflow-hidden transition-all">
          {/* Header */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all mr-0.5"
                title="Collapse Panel"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <Cloud className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider">Library</span>
            </div>
            {/* Quick Tab Switcher */}
            <div className="flex p-0.5 bg-slate-100 rounded-lg text-[9px] font-bold shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('standard')}
                className={`px-1 py-1 rounded-md transition-all ${activeTab === 'standard' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('aws')}
                className={`px-1 py-1 rounded-md transition-all ${activeTab === 'aws' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                AWS
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('libraries')}
                className={`px-1 py-1 rounded-md transition-all ${activeTab === 'libraries' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Libraries
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('custom')}
                className={`px-1 py-1 rounded-md transition-all ${activeTab === 'custom' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Search bar shared for AWS and Custom tabs */}
          {(activeTab === 'aws' || activeTab === 'custom') && (
            <div className="px-3 pt-3 pb-1 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={activeTab === 'aws' ? "Search 800+ AWS Icons..." : "Search custom library..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-800 font-medium"
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
            </div>
          )}

          {/* Tab Contents */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0">
            
            {/* 1. STANDARD GRID (INFRASTRUCTURE SVGS) */}
            {activeTab === 'standard' && (
              <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5">
                {SYSTEM_NODES.map((node) => (
                  <button
                    key={node.id}
                    disabled={loadingIcon !== null}
                    onClick={() => handleInsertIconNode(node)}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, node, 'standard')}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 hover:bg-blue-50/60 border border-slate-100 hover:border-blue-200 transition-all active:scale-95 group cursor-grab active:cursor-grabbing min-h-[76px]"
                    title={`Drag or Click to insert ${node.label}`}
                  >
                    {loadingIcon === node.id ? (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    ) : (
                      <img 
                        src={node.url} 
                        alt={node.label} 
                        className="w-8 h-8 object-contain group-hover:scale-110 transition-transform" 
                      />
                    )}
                    <span className="text-[9px] font-bold text-slate-600 mt-1.5 truncate max-w-full text-center group-hover:text-blue-600">
                      {node.label}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 2. AWS SEARCHABLE / CATEGORIZED LIST */}
            {activeTab === 'aws' && (
              <div className="flex-1 flex flex-col min-h-0 gap-2">
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
                  {displayedAWSIcons.map((icon) => (
                    <button
                      key={icon.id}
                      disabled={loadingIcon !== null}
                      onClick={() => handleInsertIconNode(icon)}
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
                
                {/* AWS Status Footer */}
                <div className="text-[8px] text-slate-400 font-semibold px-1 text-center mt-1 border-t border-slate-100 pt-1.5 shrink-0">
                  {filteredAWSIcons.length > 100 
                    ? `Showing first 100 of ${filteredAWSIcons.length} matching icons` 
                    : `Found ${filteredAWSIcons.length} matching icons`}
                </div>
              </div>
            )}

            {/* 3. FULLY CUSTOMIZABLE LIBRARY */}
            {activeTab === 'custom' && (
              <div className="flex-1 flex flex-col min-h-0 gap-2">
                {/* Form to Add New Custom Icon */}
                {isAddFormOpen ? (
                  <form onSubmit={handleAddCustomIcon} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 mb-1 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-slate-700 tracking-wider">New Custom Icon</span>
                      <button 
                        type="button" 
                        onClick={() => setIsAddFormOpen(false)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 tracking-wider">Icon Name</label>
                      <input
                        type="text"
                        placeholder="e.g. NextJS, Redis"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-800"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 tracking-wider">SVG / Image URL</label>
                      <input
                        type="url"
                        placeholder="https://example.com/logo.svg"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-800"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-slate-400 tracking-wider">Category (Optional)</label>
                      <input
                        type="text"
                        placeholder="Database, Cache, Frontend, etc."
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-800"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      Save Custom Icon
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddFormOpen(true)}
                    className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-200 rounded-xl text-xs text-slate-600 font-bold transition-all flex items-center justify-center gap-1 shrink-0 mb-1"
                  >
                    <Plus className="h-3.5 w-3.5 text-blue-500" /> Add Custom Icon
                  </button>
                )}

                {/* Custom Category Tabs */}
                {customCategories.length > 2 && (
                  <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-slate-200 select-none shrink-0">
                    {customCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCustomCategory(cat)}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border shrink-0 transition-all ${selectedCustomCategory === cat ? 'bg-blue-500 text-white border-blue-500' : 'bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100'}`}
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
                        className={`flex flex-col items-center justify-between p-1.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-blue-50/50 hover:border-blue-200 transition-all group h-[76px] relative cursor-grab active:cursor-grabbing ${loadingIcon === icon.id ? 'opacity-70' : ''}`}
                        title={`Drag or Click to insert ${icon.label}`}
                      >
                        {/* Drag / Click transparent spacer layer */}
                        <button
                          onClick={() => handleInsertIconNode(icon)}
                          className="absolute inset-0 z-0 rounded-xl"
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, icon, 'custom')}
                        />
                        
                        <div className="flex-1 flex items-center justify-center p-0.5 z-10 pointer-events-none">
                          {loadingIcon === icon.id ? (
                            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                          ) : (
                            <img 
                              src={icon.url} 
                              alt={icon.label} 
                              className="w-8 h-8 object-contain group-hover:scale-110 transition-transform"
                              onError={(e) => {
                                // Safe fallback if icon URL fails
                                e.currentTarget.src = "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/resource/User.svg";
                              }}
                              loading="lazy"
                            />
                          )}
                        </div>
                        <div className="w-full flex items-center justify-between gap-1 z-10 px-0.5 mt-1">
                          <span className="text-[8px] leading-tight font-semibold text-slate-500 truncate group-hover:text-blue-600 flex-1 select-none pointer-events-none">
                            {icon.label}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomIcon(icon.id, icon.label);
                            }}
                            className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded hover:bg-rose-50"
                            title={`Delete ${icon.label}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-100 rounded-xl bg-slate-50/20">
                    <Cloud className="h-8 w-8 text-slate-300 animate-pulse mb-1.5" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Custom Library Empty</span>
                    <span className="text-[9px] text-slate-400 leading-normal max-w-[140px]">
                      Add customized database, API, or frontend logos using the form above!
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 4. EXTENSIBLE EXCALIDRAW LIBRARIES INTEGRATION */}
            {activeTab === 'libraries' && (
              <div className="flex-1 flex flex-col min-h-0 gap-2">
                {/* Sleek Sub-Tab switcher: Active vs Community Browse */}
                <div className="flex bg-slate-100 p-0.5 rounded-xl text-[10px] font-bold select-none shrink-0 mb-1">
                  <button
                    type="button"
                    onClick={() => setLibSubTab('active')}
                    className={`flex-1 py-1 rounded-lg transition-all text-center cursor-pointer ${libSubTab === 'active' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Active Libraries
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibSubTab('browse')}
                    className={`flex-1 py-1 rounded-lg transition-all text-center cursor-pointer ${libSubTab === 'browse' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Community Directory
                  </button>
                </div>

                {libSubTab === 'active' ? (
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    {/* Select Library Dropdown & Custom Importer Form */}
                    <div className="space-y-1.5 shrink-0">
                      <div className="flex items-center justify-between">
                        <label className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Select Library</label>
                        <button
                          type="button"
                          onClick={() => setIsAddLibFormOpen(!isAddLibFormOpen)}
                          className="text-[9px] font-extrabold text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                        >
                          <Plus className="h-2.5 w-2.5" /> Import Custom
                        </button>
                      </div>
                      <select
                        value={selectedLibraryId}
                        onChange={(e) => setSelectedLibraryId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-slate-700 font-bold cursor-pointer"
                      >
                        <optgroup label="Curated Technical Libraries">
                          {CURATED_LIBRARIES.map(lib => (
                            <option key={lib.id} value={lib.id}>{lib.name}</option>
                          ))}
                        </optgroup>
                        {customLibrariesList.length > 0 && (
                          <optgroup label="Imported & Community Libraries">
                            {customLibrariesList.map(lib => (
                              <option key={lib.id} value={lib.id}>{lib.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {loadedLibraries.filter(l => l.id.startsWith('uploaded_')).length > 0 && (
                          <optgroup label="Locally Uploaded Files">
                            {loadedLibraries.filter(l => l.id.startsWith('uploaded_')).map(lib => (
                              <option key={lib.id} value={lib.id}>{lib.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* Import Custom Library URL or upload local file form */}
                    {isAddLibFormOpen && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 shrink-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-slate-700 tracking-wider">Import Library</span>
                          <button 
                            type="button" 
                            onClick={() => setIsAddLibFormOpen(false)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                        
                        {/* Option A: From Web URL */}
                        <form onSubmit={handleAddCustomLibraryUrl} className="space-y-1.5">
                          <label className="text-[8px] font-bold uppercase text-slate-400 tracking-wider block">Option 1: Raw .excalidrawlib URL</label>
                          <div className="flex gap-1">
                            <input
                              type="url"
                              placeholder="https://.../*.excalidrawlib"
                              value={customLibraryUrl}
                              onChange={(e) => setCustomLibraryUrl(e.target.value)}
                              className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-800 font-medium"
                              required
                            />
                            <button
                              type="submit"
                              className="px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold transition-all shrink-0 cursor-pointer"
                            >
                              Import
                            </button>
                          </div>
                        </form>

                        {/* Divider */}
                        <div className="relative flex py-1 items-center">
                          <div className="flex-grow border-t border-slate-200"></div>
                          <span className="flex-shrink mx-2 text-[8px] text-slate-400 font-bold uppercase">or</span>
                          <div className="flex-grow border-t border-slate-200"></div>
                        </div>

                        {/* Option B: Local File Upload */}
                        <div className="space-y-1.5">
                          <label className="text-[8px] font-bold uppercase text-slate-400 tracking-wider block">Option 2: Upload File</label>
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
                              className="w-full py-1.5 bg-white border border-dashed border-slate-300 rounded-lg text-[10px] text-slate-600 font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Upload className="h-3 w-3 text-blue-500" /> Choose .excalidrawlib file
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
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-800 font-medium"
                      />
                      {librarySearchQuery && (
                        <button 
                          type="button"
                          onClick={() => setLibrarySearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Library Shapes List */}
                    {loadingLibrary === selectedLibraryId ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                        <Loader2 className="h-6 w-6 text-blue-500 animate-spin mb-2" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider animate-pulse">Fetching Library Assets...</span>
                      </div>
                    ) : (() => {
                      const currentLib = loadedLibraries.find(l => l.id === selectedLibraryId);
                      if (!currentLib || !currentLib.items || currentLib.items.length === 0) {
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-100 rounded-xl bg-slate-50/20 mt-1">
                            <BookOpen className="h-8 w-8 text-slate-300 animate-pulse mb-1.5" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">No Assets Loaded</span>
                            <span className="text-[9px] text-slate-400 leading-normal max-w-[150px]">
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
                          <div className="text-[8px] text-slate-400 font-extrabold uppercase tracking-wider px-1 flex items-center justify-between shrink-0 mb-1">
                            <span className="truncate max-w-[170px]">{currentLib.description}</span>
                            {customLibrariesList.some(l => l.id === currentLib.id) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomLibraryUrl(currentLib.id, currentLib.name)}
                                className="text-slate-400 hover:text-rose-500 transition-colors uppercase font-black cursor-pointer"
                                title="Remove Library"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-1 gap-1">
                            {filteredItems.map((item: any, idx: number) => {
                              const name = getItemName(item.elements, idx, currentLib.itemNames);
                              const elementCount = item.elements.length;
                              
                              return (
                                <button
                                  key={`${selectedLibraryId}_item_${idx}`}
                                  type="button"
                                  onClick={() => insertLibraryElements(item.elements)}
                                  className="flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-blue-50/60 border border-slate-100 hover:border-blue-200 transition-all active:scale-[0.98] group cursor-pointer text-left w-full"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="h-7 w-7 rounded-lg bg-white border border-slate-200/50 flex items-center justify-center text-blue-500 font-extrabold text-[10px] shrink-0 shadow-sm group-hover:bg-blue-50 transition-colors">
                                      {name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold text-slate-700 truncate group-hover:text-blue-600 max-w-[170px]">
                                        {name}
                                      </div>
                                      <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                                        {elementCount === 1 ? '1 element' : `${elementCount} elements`}
                                      </div>
                                    </div>
                                  </div>
                                  <Plus className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-500 shrink-0 transition-transform group-hover:scale-110" />
                                </button>
                              );
                            })}
                            {filteredItems.length === 0 && (
                              <div className="text-center p-4 text-[10px] text-slate-400 font-bold uppercase">
                                No matching shapes found
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    {/* Community Directory Search Bar */}
                    <div className="relative shrink-0">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search 100+ community libraries..."
                        value={communitySearchQuery}
                        onChange={(e) => setCommunitySearchQuery(e.target.value)}
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-800 font-medium"
                      />
                      {communitySearchQuery && (
                        <button 
                          type="button"
                          onClick={() => setCommunitySearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Community Directory List */}
                    {fetchingCommunityDir && communityLibraries.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                        <Loader2 className="h-6 w-6 text-blue-500 animate-spin mb-2" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider animate-pulse">Loading Directory Catalog...</span>
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
                          <div className="text-[8px] text-slate-400 font-extrabold uppercase tracking-wider px-1 flex items-center justify-between shrink-0 mb-1">
                            <span>Available Libraries ({filteredCommunity.length})</span>
                            <span className="flex items-center gap-0.5 text-[7px]"><Globe className="h-2 w-2" /> Live Registry</span>
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
                                  className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1.5 text-left hover:border-slate-200 transition-colors"
                                >
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-800 flex items-center justify-between gap-1.5 leading-normal">
                                      <span className="truncate max-w-[150px]">{lib.name}</span>
                                      {isCurated && (
                                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[7px] font-black uppercase shrink-0">
                                          Curated
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[9px] text-slate-500 font-medium leading-normal mt-0.5 line-clamp-2">
                                      {lib.description}
                                    </p>
                                    <div className="text-[8px] text-slate-400 font-bold uppercase mt-1">
                                      by {authorName}
                                    </div>
                                  </div>

                                  <div className="flex justify-end pt-1 border-t border-slate-100/60 mt-0.5">
                                    {isAlreadyAvailable ? (
                                      <div className="flex items-center gap-1 text-[8px] font-black uppercase text-emerald-600 select-none bg-emerald-50/50 px-2 py-1 rounded-lg border border-emerald-100">
                                        <Check className="h-2.5 w-2.5" /> Installed
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={loadingLibrary !== null}
                                        onClick={() => handleInstallCommunityLibrary(lib)}
                                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
                              <div className="text-center py-2 text-[8px] text-slate-400 font-extrabold uppercase">
                                Showing first 50 results. Narrow search to find more.
                              </div>
                            )}

                            {filteredCommunity.length === 0 && (
                              <div className="text-center p-6 border border-dashed border-slate-100 rounded-xl bg-slate-50/20">
                                <BookOpen className="h-8 w-8 text-slate-300 mb-1.5 mx-auto animate-pulse" />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">No matches found</span>
                                <span className="text-[9px] text-slate-400 leading-normal max-w-[150px] mx-auto block text-center">
                                  Try searching for "gcp", "docker", "c4", or other system terms.
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
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