/**
 * Human-readable mirror of the real tool registry in lib/mcp/tools.ts
 * (registerCollabProTools). Single source of truth for the tool list shown
 * in the Developer Hub sandbox and MCP Settings reference card, so the two
 * pages can't silently drift out of sync with each other or with what the
 * server actually registers.
 */
export interface McpToolDoc {
  name: string;
  title: string;
  description: string;
  access: 'read' | 'write';
  params: { name: string; type: string; required: boolean; description: string }[];
  /** Pretty-printed example arguments object for tools/call. */
  exampleArgs: Record<string, unknown>;
}

export const MCP_TOOL_CATALOG: McpToolDoc[] = [
  {
    name: 'collabpro_list_files',
    title: 'List Files',
    description: 'Fetch files, folders, and collaborative workspaces matching your authenticated team scope. Paginated.',
    access: 'read',
    params: [
      { name: 'scope', type: '"org" | "team" | "personal"', required: false, description: 'Target view scope. Defaults to "org".' },
      { name: 'teamId', type: 'string', required: false, description: 'Filter to a specific team ID.' },
      { name: 'limit', type: 'number (1-200)', required: false, description: 'Max files per page, default 50.' },
      { name: 'cursor', type: 'string', required: false, description: 'nextCursor from a previous call, to page forward.' },
    ],
    exampleArgs: { scope: 'team' },
  },
  {
    name: 'collabpro_get_file',
    title: 'Get File',
    description: "Retrieve a file's full document blocks and whiteboard elements by ID.",
    access: 'read',
    params: [{ name: 'fileId', type: 'string', required: true, description: 'The file UUID to fetch.' }],
    exampleArgs: { fileId: 'YOUR_FILE_UUID' },
  },
  {
    name: 'collabpro_create_file',
    title: 'Create File',
    description: 'Create a new document/whiteboard file inside a team you belong to. Leave document/whiteboard unset to start blank.',
    access: 'write',
    params: [
      { name: 'fileName', type: 'string', required: true, description: 'Display name for the new file.' },
      { name: 'teamId', type: 'string', required: true, description: 'Team ID to create this file under - must be one of your authenticated teams.' },
      { name: 'document', type: 'object | string', required: false, description: 'Optional initial Editor.js payload. Omit for a blank document.' },
      { name: 'whiteboard', type: 'array | string', required: false, description: 'Optional initial Excalidraw elements. Omit for a blank whiteboard.' },
      { name: 'folder', type: 'string', required: false, description: 'Optional folder path, e.g. "Design/Mockups".' },
    ],
    exampleArgs: { fileName: 'New MCP File', teamId: 'YOUR_TEAM_ID' },
  },
  {
    name: 'collabpro_update_document',
    title: 'Update Document',
    description: "Overwrite a file's document with new Editor.js blocks. Compare-and-swap protected against concurrent edits.",
    access: 'write',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The file ID to modify.' },
      { name: 'document', type: 'object | string', required: true, description: 'Editor.js payload, or a JSON string of the same shape.' },
    ],
    exampleArgs: {
      fileId: 'YOUR_FILE_UUID',
      document: '{"blocks":[{"type":"paragraph","data":{"text":"Updated via CollabPro MCP"}}]}',
    },
  },
  {
    name: 'collabpro_update_whiteboard',
    title: 'Update Whiteboard',
    description: "Push new Excalidraw-compatible elements to a file's whiteboard. Server-side rejects overlapping shapes and malformed geometry.",
    access: 'write',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The target file ID.' },
      { name: 'whiteboard', type: 'array | string', required: true, description: 'Excalidraw-compatible element objects, or a JSON string of the same shape.' },
    ],
    exampleArgs: { fileId: 'YOUR_FILE_UUID', whiteboard: '[]' },
  },
  {
    name: 'collabpro_search_icon_libraries',
    title: 'Search Icon Libraries',
    description: 'Search 200+ community Excalidraw icon libraries (AWS/Azure/GCP/network/UML/BPMN/etc) by keyword.',
    access: 'read',
    params: [{ name: 'query', type: 'string', required: true, description: 'Keyword to match, e.g. "aws", "azure", "network".' }],
    exampleArgs: { query: 'aws' },
  },
  {
    name: 'collabpro_list_library_items',
    title: 'List Library Items',
    description: 'List every icon/item in one community library with a real name, derived from the item itself when the library has no metadata name - use before collabpro_get_library_icon to work through everything a library offers instead of guessing indices.',
    access: 'read',
    params: [
      { name: 'librarySource', type: 'string', required: true, description: '"source" field from collabpro_search_icon_libraries.' },
    ],
    exampleArgs: { librarySource: 'husainkhambaty/aws-simple-icons.excalidrawlib' },
  },
  {
    name: 'collabpro_get_library_icon',
    title: 'Get Library Icon',
    description: 'Fetch one icon\'s elements from a community library (from collabpro_search_icon_libraries), positioned and ID-namespaced to drop straight into a whiteboard.',
    access: 'read',
    params: [
      { name: 'librarySource', type: 'string', required: true, description: '"source" field from collabpro_search_icon_libraries.' },
      { name: 'item', type: 'string', required: true, description: '0-based item index, or a substring of the item name.' },
      { name: 'x', type: 'number', required: true, description: 'Target x position.' },
      { name: 'y', type: 'number', required: true, description: 'Target y position.' },
      { name: 'scale', type: 'number', required: false, description: 'Uniform scale factor, default 1.' },
      { name: 'idPrefix', type: 'string', required: false, description: 'Prefix for namespacing element/group IDs.' },
    ],
    exampleArgs: { librarySource: 'husainkhambaty/aws-simple-icons.excalidrawlib', item: '0', x: 100, y: 100 },
  },
];
