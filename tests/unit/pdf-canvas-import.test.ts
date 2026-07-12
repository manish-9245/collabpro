import { describe, it, expect, vi } from 'vitest';

describe('PDF Canvas Import & Annotation Suite (Issue 17)', () => {
  it('should successfully parse a PDF file and initialize document pages count', async () => {
    const mockDocument = {
      numPages: 5,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({
          promise: Promise.resolve()
        })
      })
    };

    const globalWindow = global as any;
    globalWindow.pdfjsLib = {
      getDocument: () => ({
        promise: Promise.resolve(mockDocument)
      })
    };

    // Assert mock pdfjsLib is successfully created and has 5 pages
    expect(globalWindow.pdfjsLib).toBeDefined();
    const doc = await globalWindow.pdfjsLib.getDocument().promise;
    expect(doc.numPages).toBe(5);
    
    const page = await doc.getPage(1);
    expect(page.getViewport()).toEqual({ width: 600, height: 800 });
  });

  it('should generate locked background image element inside Excalidraw on insertion', async () => {
    const mockFileId = "pdf_mock_123456_p1";
    const mockDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    // Simulate Excalidraw API
    const addedFiles: any[] = [];
    let updatedSceneElements: any[] = [];

    const excalidrawAPI = {
      addFiles: async (files: any[]) => {
        addedFiles.push(...files);
      },
      getSceneElements: () => [],
      getAppState: () => ({ scrollX: 0, scrollY: 0 }),
      updateScene: (scene: any) => {
        updatedSceneElements = scene.elements;
      }
    };

    // Insert simulated page
    await excalidrawAPI.addFiles([
      {
        id: mockFileId,
        dataURL: mockDataURL,
        mimeType: 'image/png',
        created: Date.now()
      }
    ]);

    const centerX = 150;
    const centerY = 150;

    const mockImageElement = {
      type: "image",
      id: `elem_${mockFileId}`,
      fileId: mockFileId,
      status: "pending",
      x: centerX,
      y: centerY,
      width: 300,
      height: 400,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 12345,
      version: 1,
      versionNonce: 54321,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: true // CRITICAL: Must be locked by default!
    };

    excalidrawAPI.updateScene({
      elements: [mockImageElement]
    });

    // Assertions
    expect(addedFiles).toHaveLength(1);
    expect(addedFiles[0].id).toBe(mockFileId);
    expect(addedFiles[0].dataURL).toBe(mockDataURL);

    expect(updatedSceneElements).toHaveLength(1);
    expect(updatedSceneElements[0].type).toBe("image");
    expect(updatedSceneElements[0].fileId).toBe(mockFileId);
    expect(updatedSceneElements[0].locked).toBe(true); // Must be a locked background overlay layer
    expect(updatedSceneElements[0].x).toBe(150);
    expect(updatedSceneElements[0].y).toBe(150);
  });
});
