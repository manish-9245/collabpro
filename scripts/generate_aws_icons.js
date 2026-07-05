const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'node_modules', 'aws-icons', 'icons');
const outputFilePath = path.join(__dirname, '..', 'app', '(routes)', 'workspace', '_components', 'aws_icons_list.ts');

const categories = ['architecture-service', 'resource', 'architecture-group', 'category'];
const allIcons = [];

function cleanLabel(name) {
  // If it starts with Amazon, strip it for short labels, or preserve it
  let cleanName = name;
  let prefix = "";
  if (cleanName.startsWith("Amazon")) {
    cleanName = cleanName.substring(6);
    prefix = "Amazon";
  } else if (cleanName.startsWith("AWS")) {
    cleanName = cleanName.substring(3);
    prefix = "AWS";
  }
  
  // Split camelCase words nicely
  let label = cleanName.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                       .replace(/([a-z\d])([A-Z])/g, '$1 $2')
                       .replace(/([A-Z]+)([A-Z][A-Z][a-z])/g, '$1 $2')
                       .replace(/\s+/g, ' ')
                       .trim();
                       
  // Re-attach prefix in a clean way
  if (prefix) {
    label = `${prefix} ${label}`;
  }
  
  return label;
}

categories.forEach(cat => {
  const catDir = path.join(iconsDir, cat);
  if (!fs.existsSync(catDir)) return;

  const files = fs.readdirSync(catDir);
  files.forEach(file => {
    if (file.endsWith('.svg')) {
      const name = file.replace('.svg', '');
      const label = cleanLabel(name);
      
      allIcons.push({
        id: `aws__${cat.replace(/-/g, '_')}__${name}`,
        name,
        category: cat,
        label,
        url: `https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/${cat}/${file}`
      });
    }
  });
});

const tsContent = `// Automatically generated AWS Icons List
export interface AWSIcon {
  id: string;
  name: string;
  category: string;
  label: string;
  url: string;
}

export const AWS_ICONS: AWSIcon[] = ${JSON.stringify(allIcons, null, 2)};
`;

fs.writeFileSync(outputFilePath, tsContent);
console.log(`Successfully generated ${allIcons.length} clean AWS icons in ${outputFilePath}`);
