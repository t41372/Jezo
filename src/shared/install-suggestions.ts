// Names and executables checked against npm on 2026-09-30. Suggestions are
// offered in the dialog; opening Jezo never installs or connects them.
export const INSTALL_SUGGESTIONS = [
  { id: 'browser', source: JSON.stringify({ mcpServers: { browser: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--headless'] } } }, null, 2) },
  { id: 'files', source: JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.8.31', '.'] } } }, null, 2) },
] as const
