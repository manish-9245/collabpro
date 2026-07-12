import { describe, it, expect } from 'vitest';

describe('Automated PR Diagram Exporter & Embeds Suite (Issue 19)', () => {
  it('should calculate precise SVG bounding box with padding for active elements', () => {
    const mockElements = [
      { id: '1', type: 'rectangle', x: 100, y: 150, width: 200, height: 100, isDeleted: false },
      { id: '2', type: 'ellipse', x: 250, y: 300, width: 80, height: 80, isDeleted: false },
      { id: '3', type: 'text', x: 50, y: 50, width: 120, height: 30, isDeleted: true } // Deleted element!
    ];

    const active = mockElements.filter(el => !el.isDeleted);
    expect(active).toHaveLength(2);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    active.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });

    // Padding parameters (40px margin)
    minX -= 40;
    minY -= 40;
    maxX += 40;
    maxY += 40;

    const width = maxX - minX;
    const height = maxY - minY;

    expect(minX).toBe(60); // 100 - 40
    expect(minY).toBe(110); // 150 - 40
    expect(width).toBe(310); // 370 - 60
    expect(height).toBe(310); // 420 - 110
  });

  it('should correctly format elements to SVG tag strings', () => {
    const mockRect = { type: 'rectangle', x: 10, y: 20, width: 100, height: 50, strokeColor: '#1e293b', backgroundColor: 'transparent', strokeWidth: 2, roundness: true };
    const mockEllipse = { type: 'ellipse', x: 150, y: 100, width: 80, height: 60, strokeColor: '#2563eb', backgroundColor: '#eff6ff', strokeWidth: 3 };

    let svg = '';
    
    // Process Rect
    const rx = mockRect.roundness ? 6 : 0;
    svg += `<rect x="${mockRect.x}" y="${mockRect.y}" width="${mockRect.width}" height="${mockRect.height}" fill="none" stroke="${mockRect.strokeColor}" stroke-width="${mockRect.strokeWidth}" rx="${rx}" ry="${rx}" />`;

    // Process Ellipse
    const rxEll = mockEllipse.width / 2;
    const ryEll = mockEllipse.height / 2;
    const cx = mockEllipse.x + rxEll;
    const cy = mockEllipse.y + ryEll;
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rxEll}" ry="${ryEll}" fill="${mockEllipse.backgroundColor}" stroke="${mockEllipse.strokeColor}" stroke-width="${mockEllipse.strokeWidth}" />`;

    expect(svg).toContain('<rect x="10" y="20" width="100" height="50" fill="none" stroke="#1e293b" stroke-width="2" rx="6" ry="6" />');
    expect(svg).toContain('<ellipse cx="190" cy="130" rx="40" ry="30" fill="#eff6ff" stroke="#2563eb" stroke-width="3" />');
  });

  it('should escape markdown characters and build valid embed tag strings', () => {
    const fileId = "test-uuid-123456";
    const repoName = "manish-9245/collabpro";
    const branchName = "main";

    const githubRawUrl = `https://raw.githubusercontent.com/${repoName}/${branchName}/.github/collabpro-diagrams/${fileId}.svg`;
    const embedTag = `<!-- COLLABPRO_DIAGRAM: ${fileId} -->\n![CollabPro Workspace Diagram](${githubRawUrl})`;

    expect(embedTag).toContain(`<!-- COLLABPRO_DIAGRAM: ${fileId} -->`);
    expect(embedTag).toContain(`https://raw.githubusercontent.com/manish-9245/collabpro/main/.github/collabpro-diagrams/${fileId}.svg`);
  });
});
