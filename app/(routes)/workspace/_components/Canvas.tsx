import React, { useEffect, useState, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import { FILE } from '../../dashboard/_components/FileList';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

function Canvas({onSaveTrigger,fileId,fileData,setSavingStatus}:{onSaveTrigger:any,fileId:any,fileData:FILE,setSavingStatus:any}) {
    const [whiteBoardData,setWhiteBoardData]=useState<any>();
    const updateWhiteboard=useMutation(api.files.updateWhiteboard)
    const saveTimeoutRef=useRef<NodeJS.Timeout|null>(null);
    const lastSavedDataRef=useRef<string>("");

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
            }).catch(() => {
                setSavingStatus('idle');
            });
        }, 1500);
    };

    return (
    <div style={{ height: "670px" }}>
   {fileData&& <Excalidraw 
    theme='light'
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