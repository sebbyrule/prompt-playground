import readline from 'readline';
import { db } from './db.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    handleRequest(request);
  } catch (err) {
    sendError(null, -32700, "Parse error: " + err.message);
  }
});

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    result,
    id
  }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id
  }) + "\n");
}

function listToolsDefinition() {
  return [
    {
      name: "list_projects",
      description: "List all projects, prompts, templates, and active branches inside the playground.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "get_prompt",
      description: "Retrieve full details of a specific prompt template, including its system instructions, variables, and parameters.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "The ID of the project" },
          promptId: { type: "string", description: "The ID of the prompt" }
        },
        required: ["projectId", "promptId"]
      }
    },
    {
      name: "save_prompt_version",
      description: "Save a new version of a prompt template (supporting main or custom branch versions).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          promptId: { type: "string", description: "Prompt ID" },
          systemInstruction: { type: "string", description: "System instructions text" },
          template: { type: "string", description: "Prompt template with optional {{variable}} tokens" },
          temperature: { type: "number", description: "Model temperature" },
          maxTokens: { type: "number", description: "Max output tokens" },
          description: { type: "string", description: "Reason/description for this version save" },
          branchName: { type: "string", description: "Branch name. Default is 'main'." }
        },
        required: ["projectId", "promptId", "systemInstruction", "template"]
      }
    },
    {
      name: "list_tools",
      description: "List all custom agent tools (Mock responses and executable JS scripts) registered in the playground.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "create_tool",
      description: "Create or update a custom playground tool.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Unique name of the tool (lowercase, underscores, e.g. get_weather)" },
          description: { type: "string", description: "Description of what this tool does" },
          parameters: { type: "object", description: "JSON schema defining parameters (properties, type, required)" },
          code: { type: "string", description: "JavaScript code (runs in sandbox on server)" },
          mockResponse: { type: "string", description: "JSON string containing mock response data" }
        },
        required: ["name", "description"]
      }
    }
  ];
}

async function executeTool(name, args) {
  switch (name) {
    case 'list_projects': {
      const projects = db.getProjects();
      return projects.map(p => ({
        id: p.id,
        name: p.name,
        prompts: (p.prompts || []).map(pr => ({
          id: pr.id,
          name: pr.name,
          versionsCount: (pr.versions || []).length,
          branches: (pr.branches || []).map(b => b.name)
        }))
      }));
    }

    case 'get_prompt': {
      const projects = db.getProjects();
      const project = projects.find(p => p.id === args.projectId);
      if (!project) throw new Error(`Project ${args.projectId} not found.`);
      const prompt = (project.prompts || []).find(pr => pr.id === args.promptId);
      if (!prompt) throw new Error(`Prompt ${args.promptId} not found.`);
      return {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        activeVersions: prompt.versions,
        branches: prompt.branches || []
      };
    }

    case 'save_prompt_version': {
      const projects = db.getProjects();
      const project = projects.find(p => p.id === args.projectId);
      if (!project) throw new Error(`Project ${args.projectId} not found.`);
      const prompt = (project.prompts || []).find(pr => pr.id === args.promptId);
      if (!prompt) throw new Error(`Prompt ${args.promptId} not found.`);

      const branchName = args.branchName || 'main';
      const desc = args.description || `Saved via MCP on ${new Date().toLocaleDateString()}`;
      const parameters = {
        temperature: args.temperature !== undefined ? args.temperature : 0.7,
        maxTokens: args.maxTokens !== undefined ? args.maxTokens : 2048
      };

      // Detect variables in template
      const matches = args.template.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
      const variables = Array.from(new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '').trim())));

      const newVersion = {
        version: 1, // Will be computed
        systemInstruction: args.systemInstruction,
        template: args.template,
        variables,
        parameters,
        createdAt: new Date().toISOString(),
        description: desc
      };

      if (branchName === 'main') {
        newVersion.version = prompt.versions.length + 1;
        prompt.versions.push(newVersion);
      } else {
        if (!prompt.branches) prompt.branches = [];
        let branch = prompt.branches.find(b => b.name === branchName);
        if (!branch) {
          branch = {
            name: branchName,
            baseVersion: prompt.versions.length,
            createdAt: new Date().toISOString(),
            versions: []
          };
          prompt.branches.push(branch);
        }
        newVersion.version = branch.versions.length + 1;
        branch.versions.push(newVersion);
      }

      db.saveProjects(projects);
      return { success: true, version: newVersion.version, branch: branchName };
    }

    case 'list_tools': {
      return db.getTools();
    }

    case 'create_tool': {
      const tools = db.getTools();
      const existingIdx = tools.findIndex(t => t.name === args.name);
      const newTool = {
        id: existingIdx !== -1 ? tools[existingIdx].id : 'tool_' + Date.now(),
        name: args.name,
        description: args.description,
        parameters: args.parameters || { type: 'object', properties: {} },
        code: args.code || '',
        mockResponse: args.mockResponse || '{}'
      };

      if (existingIdx !== -1) {
        tools[existingIdx] = newTool;
      } else {
        tools.push(newTool);
      }

      db.saveTools(tools);
      return { success: true, toolId: newTool.id };
    }

    default:
      throw new Error(`Tool ${name} not found`);
  }
}

async function handleRequest(req) {
  const { method, params, id } = req;
  if (!method) return;

  switch (method) {
    case 'initialize':
      return sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "promptforge-mcp", version: "1.0.0" }
      });
      
    case 'notifications/initialized':
      return;
      
    case 'tools/list':
      return sendResponse(id, { tools: listToolsDefinition() });
      
    case 'tools/call':
      try {
        const { name, arguments: args } = params;
        const result = await executeTool(name, args);
        return sendResponse(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        });
      } catch (err) {
        return sendError(id, -32603, "Internal tool error: " + err.message);
      }
      
    default:
      if (id !== undefined) {
        return sendError(id, -32601, "Method not found: " + method);
      }
  }
}
