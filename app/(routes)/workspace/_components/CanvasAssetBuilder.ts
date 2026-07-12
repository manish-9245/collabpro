export interface CanvasIconNode {
  boxId: string | null;
  imageId: string;
  textId: string | null;
  groupId: string;
  elements: any[];
  files: Record<string, {
    id: string;
    dataURL: string;
    mimeType: string;
    created: number;
  }>;
}

/**
 * Pure helper module to construct the detailed Excalidraw element groups
 * for custom, system, and cloud infrastructure nodes.
 *
 * This represents a deep module at a clean, high-leverage seam.
 */
export function buildIconNode(params: {
  iconId: string;
  label: string;
  stroke?: string;
  fill?: string;
  base64: string;
  x: number;
  y: number;
  includeCard: boolean;
  includeLabel: boolean;
}): CanvasIconNode {
  // Generate random IDs for grouping elements
  const boxId = params.includeCard ? `box_${Math.random().toString(36).substr(2, 9)}` : null;
  const imageId = `img_${Math.random().toString(36).substr(2, 9)}`;
  const textId = params.includeLabel ? `text_${Math.random().toString(36).substr(2, 9)}` : null;
  const groupId = `group_${Math.random().toString(36).substr(2, 9)}`;

  const groupIds = (params.includeCard || params.includeLabel) ? [groupId] : [];
  const elements: any[] = [];

  let imageX = params.x;
  let imageY = params.y;
  let imageW = 60;
  let imageH = 60;

  if (params.includeCard) {
    imageW = 50;
    imageH = 50;
    imageX = params.x + 25;
    imageY = params.y + 12;

    const boxElement = {
      type: "rectangle",
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      id: boxId!,
      x: params.x,
      y: params.y,
      width: 100,
      height: params.includeLabel ? 105 : 74,
      strokeColor: params.stroke || "#cbd5e1",
      backgroundColor: params.fill || "#ffffff",
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
    elements.push(boxElement);
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
    fileId: params.iconId,
    scale: [1, 1],
    locked: false,
    groupIds: groupIds,
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 1000000),
    updated: Date.now(),
    link: null
  };
  elements.push(imageElement);

  if (params.includeLabel) {
    let textX = params.x + 5;
    let textY = params.y + 74;
    let textW = 90;

    if (!params.includeCard) {
      textX = params.x - 20;
      textY = params.y + 66;
      textW = 100;
    }

    const textElement = {
      type: "text",
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      id: textId!,
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
      text: params.label,
      fontSize: 10,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      originalText: params.label,
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
    elements.push(textElement);
  }

  const files = {
    [params.iconId]: {
      id: params.iconId,
      dataURL: params.base64,
      mimeType: "image/svg+xml",
      created: Date.now()
    }
  };

  return {
    boxId,
    imageId,
    textId,
    groupId,
    elements,
    files
  };
}
