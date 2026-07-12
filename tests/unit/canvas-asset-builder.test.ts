import { describe, it, expect } from 'vitest';
import { buildIconNode } from '@/app/(routes)/workspace/_components/CanvasAssetBuilder';

describe('CanvasAssetBuilder', () => {
  it('should successfully build Excalidraw element groups when both card and label are included', () => {
    const result = buildIconNode({
      iconId: 'aws__ec2',
      label: 'EC2 Instance',
      base64: 'data:image/svg+xml;base64,mock...',
      x: 100,
      y: 200,
      includeCard: true,
      includeLabel: true
    });

    // Check basic details
    expect(result.boxId).toBeDefined();
    expect(result.boxId).not.toBeNull();
    expect(result.imageId).toBeDefined();
    expect(result.textId).toBeDefined();
    expect(result.textId).not.toBeNull();
    expect(result.groupId).toBeDefined();

    // Elements array checks
    expect(result.elements).toHaveLength(3); // rectangle (box), image, text
    
    // Rectangle box checks
    const box = result.elements[0];
    expect(box.type).toBe('rectangle');
    expect(box.x).toBe(100);
    expect(box.y).toBe(200);
    expect(box.width).toBe(100);
    expect(box.height).toBe(105);
    expect(box.groupIds).toContain(result.groupId);

    // Image checks
    const image = result.elements[1];
    expect(image.type).toBe('image');
    expect(image.x).toBe(125); // 100 + 25
    expect(image.y).toBe(212); // 200 + 12
    expect(image.width).toBe(50);
    expect(image.height).toBe(50);
    expect(image.fileId).toBe('aws__ec2');
    expect(image.groupIds).toContain(result.groupId);

    // Text checks
    const text = result.elements[2];
    expect(text.type).toBe('text');
    expect(text.x).toBe(105); // 100 + 5
    expect(text.y).toBe(274); // 200 + 74
    expect(text.text).toBe('EC2 Instance');
    expect(text.groupIds).toContain(result.groupId);

    // Files check
    expect(result.files['aws__ec2']).toBeDefined();
    expect(result.files['aws__ec2'].dataURL).toBe('data:image/svg+xml;base64,mock...');
  });

  it('should successfully build elements when card is excluded but label is included', () => {
    const result = buildIconNode({
      iconId: 'aws__s3',
      label: 'S3 Bucket',
      base64: 'data:image/svg+xml;base64,mock2...',
      x: 150,
      y: 250,
      includeCard: false,
      includeLabel: true
    });

    expect(result.boxId).toBeNull();
    expect(result.textId).not.toBeNull();
    expect(result.elements).toHaveLength(2); // image, text

    const image = result.elements[0];
    expect(image.type).toBe('image');
    expect(image.x).toBe(150); // no offset since there's no card
    expect(image.y).toBe(250);
    expect(image.width).toBe(60);
    expect(image.height).toBe(60);

    const text = result.elements[1];
    expect(text.type).toBe('text');
    expect(text.x).toBe(130); // 150 - 20 (offset for no-card)
    expect(text.y).toBe(316); // 250 + 66
    expect(text.text).toBe('S3 Bucket');
  });

  it('should successfully build elements when label is excluded but card is included', () => {
    const result = buildIconNode({
      iconId: 'aws__rds',
      label: 'RDS DB',
      base64: 'data:image/svg+xml;base64,mock3...',
      x: 300,
      y: 400,
      includeCard: true,
      includeLabel: false
    });

    expect(result.boxId).not.toBeNull();
    expect(result.textId).toBeNull();
    expect(result.elements).toHaveLength(2); // rectangle, image

    const box = result.elements[0];
    expect(box.type).toBe('rectangle');
    expect(box.height).toBe(74); // height is 74 when includeLabel is false
  });
});
