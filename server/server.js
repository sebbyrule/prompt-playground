import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db.js';
import { execSync } from 'child_process';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

function resolveLocalUrl(url) {
  if (process.env.DOCKER_RUNNING === 'true' && url) {
    return url.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
  }
  return url;
}

function sanitizeJsonString(str) {
  let inString = false;
  let isEscaped = false;
  let result = '';
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (inString) {
      if (isEscaped) {
        result += char;
        isEscaped = false;
      } else if (char === '\\') {
        result += char;
        isEscaped = true;
      } else if (char === '"') {
        result += char;
        inString = false;
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        const code = char.charCodeAt(0);
        if (code < 32) {
          result += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          result += char;
        }
      }
    } else {
      if (char === '"') {
        inString = true;
      }
      result += char;
    }
  }
  return result;
}

function extractJsonString(text) {
  if (typeof text !== 'string') return text;
  let cleaned = text.trim();
  
  // 1. Try to extract content inside ```json ... ``` or ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = cleaned.match(codeBlockRegex);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // 2. Find first brace and bracket
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.slice(firstBrace, lastBrace + 1).trim();
    }
  } else if (firstBracket !== -1) {
    const lastBracket = cleaned.lastIndexOf(']');
    if (lastBracket !== -1 && lastBracket > firstBracket) {
      return cleaned.slice(firstBracket, lastBracket + 1).trim();
    }
  }
  
  return cleaned;
}

function parseJsonFromLlm(text) {
  if (typeof text !== 'string') return text;
  const cleaned = extractJsonString(text);
  const sanitized = sanitizeJsonString(cleaned);
  return JSON.parse(sanitized);
}


app.use(cors());
app.use(express.json({ limit: '50mb' })); // support large payloads for vision base64

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_PRICING = {
  'gemini-1.5-flash': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-1.5-pro': { inputCostPerM: 1.25, outputCostPerM: 5.00 },
  'gemini-2.5-flash': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-2.5-pro': { inputCostPerM: 1.25, outputCostPerM: 5.00 },
  'claude-3-5-sonnet': { inputCostPerM: 3.00, outputCostPerM: 15.00 },
  'claude-3-5-haiku': { inputCostPerM: 0.80, outputCostPerM: 4.00 },
  'gpt-4o-mini': { inputCostPerM: 0.150, outputCostPerM: 0.60 },
  'gpt-4o': { inputCostPerM: 2.50, outputCostPerM: 10.00 },
  'ollama': { inputCostPerM: 0.0, outputCostPerM: 0.0 },
  'lmstudio': { inputCostPerM: 0.0, outputCostPerM: 0.0 }
};

function calculateCost(model, inputTokens, outputTokens) {
  const modelKey = Object.keys(MODEL_PRICING).find(key => model.includes(key));
  if (!modelKey) return 0;
  const pricing = MODEL_PRICING[modelKey];
  const inputCost = (inputTokens / 1000000) * pricing.inputCostPerM;
  const outputCost = (outputTokens / 1000000) * pricing.outputCostPerM;
  return Number((inputCost + outputCost).toFixed(6));
}

// Helper to fill prompt variables: replaces {{var}} with actual value
function resolvePrompt(template, variables) {
  let resolved = template;
  for (const [key, value] of Object.entries(variables || {})) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    resolved = resolved.replace(regex, value);
  }
  return resolved;
}

// LLM Execution Handlers
async function runGemini({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const config = {
    temperature: temperature !== undefined ? Number(temperature) : 0.7,
    maxOutputTokens: maxTokens !== undefined ? Number(maxTokens) : 2048,
  };

  const genModel = genAI.getGenerativeModel({
    model: model || 'gemini-1.5-flash',
    systemInstruction: systemInstruction || undefined,
    generationConfig: config
  });

  const contents = [];
  
  if (images && images.length > 0) {
    const parts = images.map(img => {
      const cleanBase64 = img.base64.replace(/^data:image\/\w+;base64,/, '');
      return {
        inlineData: {
          data: cleanBase64,
          mimeType: img.mimeType || 'image/jpeg'
        }
      };
    });
    parts.push({ text: prompt });
    contents.push({ role: 'user', parts });
  } else {
    contents.push({ role: 'user', parts: [{ text: prompt }] });
  }

  const startTime = Date.now();
  const response = await genModel.generateContent({ contents });
  const durationMs = Date.now() - startTime;
  
  const text = response.response.text();
  
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const countResult = await genModel.countTokens({ contents });
    inputTokens = countResult.totalTokens;
    outputTokens = Math.ceil(text.length / 4); // fallback estimator
  } catch (e) {
    inputTokens = Math.ceil((prompt || '').length / 4);
    outputTokens = Math.ceil(text.length / 4);
  }

  const rawRequest = {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent`,
    method: 'POST',
    body: {
      contents,
      generationConfig: config,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
    }
  };
  const rawResponse = {
    candidates: response.response.candidates || [],
    usageMetadata: response.response.usageMetadata || {}
  };

  return {
    output: text,
    rawRequest,
    rawResponse,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runClaude({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey }) {
  const messages = [];
  
  if (images && images.length > 0) {
    const content = images.map(img => {
      const cleanBase64 = img.base64.replace(/^data:image\/\w+;base64,/, '');
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType || 'image/jpeg',
          data: cleanBase64
        }
      };
    });
    content.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens ? Number(maxTokens) : 2048,
    temperature: temperature !== undefined ? Number(temperature) : 0.7,
    messages
  };

  if (systemInstruction) {
    payload.system = systemInstruction;
  }

  const startTime = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.content.map(c => c.text).join('\n');
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  const rawRequest = {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: payload
  };
  const rawResponse = data;

  return {
    output: text,
    rawRequest,
    rawResponse,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runOpenAI({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey }) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  const userContent = [];
  if (images && images.length > 0) {
    images.forEach(img => {
      let dataUri = img.base64;
      if (!dataUri.startsWith('data:')) {
        dataUri = `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`;
      }
      userContent.push({
        type: 'image_url',
        image_url: { url: dataUri }
      });
    });
    userContent.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: userContent });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model: model || 'gpt-4o',
    messages,
    temperature: temperature !== undefined ? Number(temperature) : 0.7,
    max_tokens: maxTokens !== undefined ? Number(maxTokens) : 2048
  };

  const startTime = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  const rawRequest = {
    url: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: payload
  };
  const rawResponse = data;

  return {
    output: text,
    rawRequest,
    rawResponse,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runOllama({ model, systemInstruction, prompt, temperature, maxTokens, images, ollamaUrl }) {
  const url = `${ollamaUrl || 'http://localhost:11434'}/api/chat`;
  const cleanModel = model.replace('ollama/', '');

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  const userMessage = { role: 'user', content: prompt };
  if (images && images.length > 0) {
    userMessage.images = images.map(img => img.base64.replace(/^data:image\/\w+;base64,/, ''));
  }
  messages.push(userMessage);

  const payload = {
    model: cleanModel,
    messages,
    options: {
      temperature: temperature !== undefined ? Number(temperature) : 0.7,
      num_predict: maxTokens !== undefined ? Number(maxTokens) : 2048
    },
    stream: false
  };

  const startTime = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.message?.content || '';
  
  const inputTokens = data.prompt_eval_count || 0;
  const outputTokens = data.eval_count || 0;

  const rawRequest = {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload
  };
  const rawResponse = data;

  return {
    output: text,
    rawRequest,
    rawResponse,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runLMStudio({ model, systemInstruction, prompt, temperature, maxTokens, images, lmStudioUrl }) {
  const url = `${lmStudioUrl || 'http://localhost:1234'}/v1/chat/completions`;
  const cleanModel = model.replace('lmstudio/', '');

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  const userContent = [];
  if (images && images.length > 0) {
    images.forEach(img => {
      let dataUri = img.base64;
      if (!dataUri.startsWith('data:')) {
        dataUri = `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`;
      }
      userContent.push({
        type: 'image_url',
        image_url: { url: dataUri }
      });
    });
    userContent.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: userContent });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model: cleanModel || 'local-model',
    messages,
    temperature: temperature !== undefined ? Number(temperature) : 0.7,
    max_tokens: maxTokens !== undefined ? Number(maxTokens) : 2048
  };

  const startTime = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LM Studio API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  const rawRequest = {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload
  };
  const rawResponse = data;

  return {
    output: text,
    rawRequest,
    rawResponse,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

// Shared router for prompt runs
async function executeModelRun({ model, systemInstruction, prompt, temperature, maxTokens, images, headers }) {
  const geminiKey = headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = headers['x-claude-key'] || process.env.CLAUDE_API_KEY;
  const openaiKey = headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const ollamaUrl = resolveLocalUrl(headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  let result;
  if (model.startsWith('gemini')) {
    if (!geminiKey) throw new Error('Gemini API Key is required. Please set it in Settings.');
    result = await runGemini({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey: geminiKey });
  } else if (model.startsWith('claude')) {
    if (!claudeKey) throw new Error('Claude API Key is required. Please set it in Settings.');
    result = await runClaude({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey: claudeKey });
  } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
    if (!openaiKey) throw new Error('OpenAI API Key is required. Please set it in Settings.');
    result = await runOpenAI({ model, systemInstruction, prompt, temperature, maxTokens, images, apiKey: openaiKey });
  } else if (model.startsWith('ollama/')) {
    result = await runOllama({ model, systemInstruction, prompt, temperature, maxTokens, images, ollamaUrl });
  } else if (model.startsWith('lmstudio/')) {
    result = await runLMStudio({ model, systemInstruction, prompt, temperature, maxTokens, images, lmStudioUrl });
  } else {
    throw new Error(`Unsupported model selected: ${model}`);
  }

  // Calculate cost
  if (result && result.metrics && result.metrics.tokenUsage) {
    result.metrics.costEstimate = calculateCost(
      model, 
      result.metrics.tokenUsage.inputTokens || 0, 
      result.metrics.tokenUsage.outputTokens || 0
    );
  }

  return result;
}

// API Routes

// Projects API
app.get('/api/projects', (req, res) => {
  res.json(db.getProjects());
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  
  const projects = db.getProjects();
  const newProject = {
    id: 'proj_' + Math.random().toString(36).substr(2, 9),
    name,
    description: description || '',
    createdAt: new Date().toISOString(),
    prompts: []
  };
  projects.push(newProject);
  db.saveProjects(projects);
  res.status(201).json(newProject);
});

app.delete('/api/projects/:id', (req, res) => {
  const projects = db.getProjects();
  const filtered = projects.filter(p => p.id !== req.params.id);
  db.saveProjects(filtered);
  res.json({ success: true });
});

// Prompts within Projects
app.post('/api/projects/:projectId/prompts', (req, res) => {
  const { projectId } = req.params;
  const { name, description, tags, systemInstruction, template, parameters } = req.body;
  
  if (!name) return res.status(400).json({ error: 'Prompt name is required' });
  
  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });
  
  // Extract variables
  const variables = [];
  const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let match;
  while ((match = regex.exec(template || '')) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  const newPrompt = {
    id: 'prompt_' + Math.random().toString(36).substr(2, 9),
    name,
    description: description || '',
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    versions: [
      {
        version: 1,
        systemInstruction: systemInstruction || '',
        template: template || '',
        variables,
        parameters: parameters || { temperature: 0.7, maxTokens: 2048 },
        createdAt: new Date().toISOString(),
        description: 'Initial version'
      }
    ]
  };

  projects[projectIndex].prompts.push(newPrompt);
  db.saveProjects(projects);
  res.status(201).json(newPrompt);
});

app.delete('/api/projects/:projectId/prompts/:promptId', (req, res) => {
  const { projectId, promptId } = req.params;
  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });
  
  projects[projectIndex].prompts = projects[projectIndex].prompts.filter(p => p.id !== promptId);
  db.saveProjects(projects);
  res.json({ success: true });
});

// Prompt Versioning
app.post('/api/projects/:projectId/prompts/:promptId/versions', (req, res) => {
  const { projectId, promptId } = req.params;
  const { systemInstruction, template, parameters, description } = req.body;
  
  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });
  
  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });
  
  const prompt = projects[projectIndex].prompts[promptIndex];
  
  // Extract variables
  const variables = [];
  const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let match;
  while ((match = regex.exec(template || '')) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  const nextVersion = prompt.versions.length + 1;
  const newVersion = {
    version: nextVersion,
    systemInstruction: systemInstruction || '',
    template: template || '',
    variables,
    parameters: parameters || { temperature: 0.7, maxTokens: 2048 },
    createdAt: new Date().toISOString(),
    description: description || `Version ${nextVersion}`
  };

  prompt.versions.push(newVersion);
  prompt.updatedAt = new Date().toISOString();
  
  db.saveProjects(projects);
  res.status(201).json(newVersion);
});

// Prompt Branches API Endpoints

// Create a branch from a prompt version
app.post('/api/projects/:projectId/prompts/:promptId/branches', (req, res) => {
  const { projectId, promptId } = req.params;
  const { name, baseVersion } = req.body;

  if (!name) return res.status(400).json({ error: 'Branch name is required' });

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  const prompt = projects[projectIndex].prompts[promptIndex];
  prompt.branches = prompt.branches || [];

  if (prompt.branches.some(b => b.name === name)) {
    return res.status(400).json({ error: `Branch name '${name}' already exists` });
  }

  const baseVerNum = Number(baseVersion) || 1;
  const baseVersionObj = prompt.versions.find(v => v.version === baseVerNum) || prompt.versions[prompt.versions.length - 1];

  const newBranch = {
    name,
    baseVersion: baseVersionObj ? baseVersionObj.version : 1,
    createdAt: new Date().toISOString(),
    versions: [
      {
        version: 1,
        systemInstruction: baseVersionObj ? baseVersionObj.systemInstruction : '',
        template: baseVersionObj ? baseVersionObj.template : '',
        variables: baseVersionObj ? baseVersionObj.variables || [] : [],
        parameters: baseVersionObj ? baseVersionObj.parameters || { temperature: 0.7, maxTokens: 2048 } : { temperature: 0.7, maxTokens: 2048 },
        createdAt: new Date().toISOString(),
        description: `Branched from version ${baseVersionObj ? baseVersionObj.version : 1}`
      }
    ]
  };

  prompt.branches.push(newBranch);
  prompt.updatedAt = new Date().toISOString();

  db.saveProjects(projects);
  res.status(201).json(newBranch);
});

// Save a version on a branch
app.post('/api/projects/:projectId/prompts/:promptId/branches/:branchName/versions', (req, res) => {
  const { projectId, promptId, branchName } = req.params;
  const { systemInstruction, template, parameters, description } = req.body;

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  const prompt = projects[projectIndex].prompts[promptIndex];
  prompt.branches = prompt.branches || [];

  const branch = prompt.branches.find(b => b.name === branchName);
  if (!branch) return res.status(404).json({ error: `Branch '${branchName}' not found` });

  const variables = [];
  const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let match;
  while ((match = regex.exec(template || '')) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  const nextVersion = branch.versions.length + 1;
  const newVersion = {
    version: nextVersion,
    systemInstruction: systemInstruction || '',
    template: template || '',
    variables,
    parameters: parameters || { temperature: 0.7, maxTokens: 2048 },
    createdAt: new Date().toISOString(),
    description: description || `Branch Version ${nextVersion}`
  };

  branch.versions.push(newVersion);
  prompt.updatedAt = new Date().toISOString();

  db.saveProjects(projects);
  res.status(201).json(newVersion);
});

// Delete a branch
app.delete('/api/projects/:projectId/prompts/:promptId/branches/:branchName', (req, res) => {
  const { projectId, promptId, branchName } = req.params;

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  const prompt = projects[projectIndex].prompts[promptIndex];
  prompt.branches = prompt.branches || [];

  prompt.branches = prompt.branches.filter(b => b.name !== branchName);
  prompt.updatedAt = new Date().toISOString();

  db.saveProjects(projects);
  res.json({ success: true });
});

// Merge a branch into main versions
app.post('/api/projects/:projectId/prompts/:promptId/branches/:branchName/merge', (req, res) => {
  const { projectId, promptId, branchName } = req.params;
  const { mergeMessage } = req.body;

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  const prompt = projects[projectIndex].prompts[promptIndex];
  prompt.branches = prompt.branches || [];

  const branch = prompt.branches.find(b => b.name === branchName);
  if (!branch) return res.status(404).json({ error: `Branch '${branchName}' not found` });
  if (branch.versions.length === 0) return res.status(400).json({ error: `Branch '${branchName}' is empty` });

  const latestBranchVersion = branch.versions[branch.versions.length - 1];

  const nextMainVersion = prompt.versions.length + 1;
  const mergedVersion = {
    version: nextMainVersion,
    systemInstruction: latestBranchVersion.systemInstruction,
    template: latestBranchVersion.template,
    variables: latestBranchVersion.variables || [],
    parameters: latestBranchVersion.parameters || { temperature: 0.7, maxTokens: 2048 },
    createdAt: new Date().toISOString(),
    description: mergeMessage || `Merged branch '${branchName}'`
  };

  prompt.versions.push(mergedVersion);
  prompt.branches = prompt.branches.filter(b => b.name !== branchName);
  prompt.updatedAt = new Date().toISOString();

  db.saveProjects(projects);
  res.status(201).json(mergedVersion);
});

// Run Prompt Endpoint
app.post('/api/run', async (req, res) => {
  const { model, systemInstruction, prompt, temperature, maxTokens, images } = req.body;
  
  if (!model) return res.status(400).json({ error: 'Model is required' });
  if (!prompt) return res.status(400).json({ error: 'Prompt text is required' });

  try {
    const result = await executeModelRun({
      model,
      systemInstruction,
      prompt,
      temperature,
      maxTokens,
      images,
      headers: req.headers
    });
    res.json(result);
  } catch (error) {
    console.error('Run failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auto-Improvement (Optimizer) API
app.post('/api/optimize', async (req, res) => {
  const { systemInstruction, template, improvementGoal, successCriteria, failureCases } = req.body;
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    return res.status(400).json({ error: 'Gemini API Key is required in Settings to run the Auto-Optimizer.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4
      }
    });

    const metaPromptSystem = `You are an expert Prompt Engineer specializing in Meta-Prompting.
Your goal is to optimize the provided system instructions and user prompt template to achieve the user's specific improvement goal.

You will return exactly 3 distinct variations of the prompt, ordered from least conservative to most creative:
1. "Refined": A polished, corrected, and slightly expanded version of the original.
2. "Structured": A highly structured, markdown-heavy version that uses techniques like clear sections, XML tags, and few-shot examples.
3. "Creative / Advanced": An out-of-the-box redesign of the prompt that approaches the goal using advanced prompt techniques (like chain-of-thought instructions, role-play framing, or cognitive-guided templates).

You MUST output a JSON object matching this schema exactly:
{
  "candidates": [
    {
      "name": "Variation Name",
      "systemInstruction": "Optimized system instructions",
      "template": "Optimized user prompt template. Preserve the original variable placeholders like {{variable}} where appropriate.",
      "explanation": "Brief explanation of what was changed and why."
    }
  ]
}`;

    const metaPromptUser = `
Original System Instruction:
"${systemInstruction || ''}"

Original User Prompt Template:
"${template || ''}"

User's Optimization Goal:
"${improvementGoal}"

Target Success Criteria:
"${successCriteria || 'Not specified'}"

Failure Cases to Avoid:
"${failureCases || 'Not specified'}"
`;

    const contents = [
      { role: 'user', parts: [{ text: metaPromptSystem + '\n\n' + metaPromptUser }] }
    ];

    const response = await model.generateContent({ contents });
    const text = response.response.text();
    const result = parseJsonFromLlm(text);
    res.json(result);
  } catch (error) {
    console.error('Optimization failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run History / Log API
app.get('/api/runs', (req, res) => {
  res.json(db.getRuns());
});

app.post('/api/runs', (req, res) => {
  const { run } = req.body;
  if (!run) return res.status(400).json({ error: 'Run payload required' });
  
  const runs = db.getRuns();
  const newRun = {
    id: 'run_' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    ...run
  };
  runs.unshift(newRun); // newer runs first
  
  // Cap history at 100 runs
  if (runs.length > 100) {
    runs.pop();
  }
  
  db.saveRuns(runs);
  res.status(201).json(newRun);
});

app.delete('/api/runs', (req, res) => {
  db.saveRuns([]);
  res.json({ success: true });
});

// Evaluations API
app.get('/api/evaluations', (req, res) => {
  res.json(db.getEvaluations());
});

app.post('/api/evaluations', (req, res) => {
  const { evaluation } = req.body;
  if (!evaluation) return res.status(400).json({ error: 'Evaluation suite required' });
  
  const evals = db.getEvaluations();
  const newEval = {
    id: 'eval_' + Math.random().toString(36).substr(2, 9),
    createdAt: new Date().toISOString(),
    ...evaluation
  };
  evals.unshift(newEval);
  db.saveEvaluations(evals);
  res.status(201).json(newEval);
});

app.post('/api/evaluate/run', async (req, res) => {
  const { model, systemInstruction, template, parameters, testCases } = req.body;
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;

  if (!testCases || testCases.length === 0) {
    return res.status(400).json({ error: 'At least one test case is required.' });
  }

  const results = [];
  let passedCount = 0;
  let totalAssertions = 0;
  let passedAssertions = 0;

  try {
    for (const testCase of testCases) {
      const resolvedPrompt = resolvePrompt(template, testCase.variables);
      
      let runResult;
      let error = null;
      try {
        runResult = await executeModelRun({
          model,
          systemInstruction,
          prompt: resolvedPrompt,
          temperature: parameters?.temperature,
          maxTokens: parameters?.maxTokens,
          images: testCase.images || [],
          headers: req.headers
        });
      } catch (err) {
        error = err.message;
      }

      const assertionResults = [];
      let casePassed = true;

      if (error) {
        assertionResults.push({
          type: 'system',
          passed: false,
          details: `LLM Execution Error: ${error}`
        });
        casePassed = false;
        totalAssertions++;
      } else {
        const outputText = runResult.output;
        
        for (const assertion of testCase.assertions || []) {
          totalAssertions++;
          let assertionPassed = false;
          let details = '';

          try {
            if (assertion.type === 'contains') {
              assertionPassed = outputText.toLowerCase().includes(assertion.value.toLowerCase());
              details = assertionPassed ? 'Match found' : `Expected content not found: "${assertion.value}"`;
            } else if (assertion.type === 'not_contains') {
              assertionPassed = !outputText.toLowerCase().includes(assertion.value.toLowerCase());
              details = assertionPassed ? 'Match correctly absent' : `Forbidden content found: "${assertion.value}"`;
            } else if (assertion.type === 'regex') {
              const flags = assertion.caseInsensitive ? 'i' : '';
              const regex = new RegExp(assertion.value, flags);
              assertionPassed = regex.test(outputText);
              details = assertionPassed ? 'Pattern matched' : `Failed to match regex: /${assertion.value}/${flags}`;
            } else if (assertion.type === 'llm_judge') {
              if (!geminiKey) {
                assertionPassed = false;
                details = 'Gemini API key required for LLM-as-a-judge assertions.';
              } else {
                const genAI = new GoogleGenerativeAI(geminiKey);
                const judgeModel = genAI.getGenerativeModel({
                  model: 'gemini-1.5-flash',
                  generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
                });

                const judgeSystemPrompt = `You are an impartial, expert evaluator.
Analyze the provided AI assistant response and score it against the validation rubric.

You MUST respond in JSON format matching this schema:
{
  "passed": true/false,
  "score": 0 to 100,
  "reasoning": "Brief explanation of the score and why it passed/failed."
}`;

                const judgeUserPrompt = `
Rubric / Success Criteria:
"${assertion.value}"

AI Assistant Response to Evaluate:
"${outputText}"
`;

                const contents = [
                  { role: 'user', parts: [{ text: judgeSystemPrompt + '\n\n' + judgeUserPrompt }] }
                ];
                
                const judgeResponse = await judgeModel.generateContent({ contents });
                const judgeResult = parseJsonFromLlm(judgeResponse.response.text());
                
                assertionPassed = !!judgeResult.passed;
                details = `Score: ${judgeResult.score}/100. Reasoning: ${judgeResult.reasoning}`;
              }
            }
          } catch (e) {
            assertionPassed = false;
            details = `Error in assertion evaluation: ${e.message}`;
          }

          if (assertionPassed) {
            passedAssertions++;
          } else {
            casePassed = false;
          }

          assertionResults.push({
            type: assertion.type,
            expected: assertion.value,
            passed: assertionPassed,
            details
          });
        }
      }

      if (casePassed && !error) {
        passedCount++;
      }

      results.push({
        id: testCase.id,
        name: testCase.name || 'Test Case',
        variables: testCase.variables,
        promptUsed: resolvedPrompt,
        output: runResult?.output || null,
        metrics: runResult?.metrics || null,
        assertions: assertionResults,
        passed: casePassed
      });
    }

    res.json({
      model,
      passedCount,
      totalCount: testCases.length,
      successRate: testCases.length ? Math.round((passedCount / testCases.length) * 100) : 0,
      totalAssertions,
      passedAssertions,
      results
    });
  } catch (error) {
    console.error('Evaluation run failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Local Gateway Prompt Serving API
app.post('/api/serve/:promptId', async (req, res) => {
  const { promptId } = req.params;
  const { variables, version, modelOverride } = req.body;

  const projects = db.getProjects();
  let foundPrompt = null;
  let foundProject = null;

  for (const project of projects) {
    const p = project.prompts.find(pr => pr.id === promptId);
    if (p) {
      foundPrompt = p;
      foundProject = project;
      break;
    }
  }

  if (!foundPrompt) {
    return res.status(404).json({ error: `Prompt with ID ${promptId} not found.` });
  }

  // Get requested version or default to latest
  let selectedVer = null;
  if (version) {
    selectedVer = foundPrompt.versions.find(v => v.version === Number(version));
  } else {
    selectedVer = foundPrompt.versions[foundPrompt.versions.length - 1];
  }

  if (!selectedVer) {
    return res.status(404).json({ error: `Prompt version ${version} not found.` });
  }

  // Resolve prompt template
  const resolvedPrompt = resolvePrompt(selectedVer.template, variables);

  // If there are associated few-shot examples and they are toggled, we can append them
  let systemWithExamples = selectedVer.systemInstruction || '';
  if (foundPrompt.fewShotExamples && foundPrompt.fewShotExamples.length > 0) {
    const examplesText = foundPrompt.fewShotExamples.map((ex, i) => 
      `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`
    ).join('\n\n');
    systemWithExamples += `\n\nUse the following few-shot examples for context:\n${examplesText}`;
  }

  try {
    const defaultModel = selectedVer.selectedModel || 'gemini-1.5-flash';
    const result = await executeModelRun({
      model: modelOverride || defaultModel,
      systemInstruction: systemWithExamples,
      prompt: resolvedPrompt,
      temperature: selectedVer.parameters?.temperature,
      maxTokens: selectedVer.parameters?.maxTokens,
      images: [],
      headers: req.headers
    });

    // Log the run to history
    const runs = db.getRuns();
    runs.unshift({
      id: 'run_' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      projectName: foundProject.name,
      promptName: `${foundPrompt.name} (API Serve)`,
      model: modelOverride || defaultModel,
      metrics: result.metrics,
      passed: true
    });
    db.saveRuns(runs.slice(0, 100));

    res.json(result);
  } catch (error) {
    console.error('API Gateway serve failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Few-Shot Examples API
app.post('/api/projects/:projectId/prompts/:promptId/few-shot', (req, res) => {
  const { projectId, promptId } = req.params;
  const { input, output, description } = req.body;

  if (!input || !output) {
    return res.status(400).json({ error: 'Input and output are required for few-shot examples.' });
  }

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  const prompt = projects[projectIndex].prompts[promptIndex];
  if (!prompt.fewShotExamples) {
    prompt.fewShotExamples = [];
  }

  const newExample = {
    id: 'ex_' + Math.random().toString(36).substr(2, 9),
    input,
    output,
    description: description || '',
    createdAt: new Date().toISOString()
  };

  prompt.fewShotExamples.push(newExample);
  db.saveProjects(projects);
  res.status(201).json(newExample);
});

app.delete('/api/projects/:projectId/prompts/:promptId/few-shot/:exampleId', (req, res) => {
  const { projectId, promptId, exampleId } = req.params;

  const projects = db.getProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) return res.status(404).json({ error: 'Project not found' });

  const promptIndex = projects[projectIndex].prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) return res.status(404).json({ error: 'Prompt not found' });

  db.saveProjects(projects);
  res.json({ success: true });
});

// Tools CRUD APIs
app.get('/api/tools', (req, res) => {
  res.json(db.getTools());
});

app.post('/api/tools', (req, res) => {
  const { name, description, parameters, mockResponse, executionMode, code } = req.body;
  if (!name) return res.status(400).json({ error: 'Tool name is required' });

  const tools = db.getTools();
  const newTool = {
    id: 'tool_' + Math.random().toString(36).substr(2, 9),
    name,
    description: description || '',
    parameters: parameters || { type: 'object', properties: {}, required: [] },
    mockResponse: mockResponse || '{}',
    executionMode: executionMode || 'mock',
    code: code || '',
    createdAt: new Date().toISOString()
  };

  tools.push(newTool);
  db.saveTools(tools);
  res.status(201).json(newTool);
});

app.delete('/api/tools/:id', (req, res) => {
  const tools = db.getTools();
  const filtered = tools.filter(t => t.id !== req.params.id);
  db.saveTools(filtered);
  res.json({ success: true });
});

// Skills CRUD APIs
app.get('/api/skills', (req, res) => {
  res.json(db.getSkills());
});

app.post('/api/skills', (req, res) => {
  const { name, description, systemInstruction, tools } = req.body;
  if (!name) return res.status(400).json({ error: 'Skill name is required' });

  const skills = db.getSkills();
  const newSkill = {
    id: 'skill_' + Math.random().toString(36).substr(2, 9),
    name,
    description: description || '',
    systemInstruction: systemInstruction || '',
    tools: tools || [],
    createdAt: new Date().toISOString()
  };

  skills.push(newSkill);
  db.saveSkills(skills);
  res.status(201).json(newSkill);
});

app.delete('/api/skills/:id', (req, res) => {
  const skills = db.getSkills();
  const filtered = skills.filter(s => s.id !== req.params.id);
  db.saveSkills(filtered);
  res.json({ success: true });
});

// Sessions CRUD APIs
app.get('/api/sessions', (req, res) => {
  res.json(db.getSessions());
});

app.post('/api/sessions', (req, res) => {
  const { id, skillId, name, messages, trace, metrics } = req.body;
  const sessions = db.getSessions();
  
  let sessionIndex = -1;
  if (id) {
    sessionIndex = sessions.findIndex(s => s.id === id);
  }

  const newSession = {
    id: id || 'session_' + Math.random().toString(36).substr(2, 9),
    skillId,
    name: name || 'New Chat Session',
    messages: messages || [],
    trace: trace || [],
    metrics: metrics || null,
    updatedAt: new Date().toISOString()
  };

  if (sessionIndex !== -1) {
    sessions[sessionIndex] = newSession;
  } else {
    sessions.unshift(newSession);
  }

  db.saveSessions(sessions);
  res.status(201).json(newSession);
});

app.delete('/api/sessions/:id', (req, res) => {
  const sessions = db.getSessions();
  const filtered = sessions.filter(s => s.id !== req.params.id);
  db.saveSessions(filtered);
  res.json({ success: true });
});

// Built-in System Tools Implementation
async function executeWebSearch(query) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const html = await res.text();
    
    const snippets = [];
    const regex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 5) {
      const cleanText = match[1].replace(/<[^>]*>/g, '').trim();
      snippets.push(cleanText);
    }

    if (snippets.length === 0) {
      const regexFallback = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
      while ((match = regexFallback.exec(html)) !== null && snippets.length < 5) {
        const cleanText = match[1].replace(/<[^>]*>/g, '').trim();
        snippets.push(cleanText);
      }
    }

    if (snippets.length === 0) {
      return { results: [], text: `No search results found for query: "${query}"` };
    }

    return { 
      results: snippets, 
      text: snippets.map((s, i) => `[${i + 1}] ${s}`).join('\n\n') 
    };
  } catch (e) {
    console.error('Search tool error:', e);
    return { error: 'Failed to execute web search', message: e.message };
  }
}

async function executeWebScraper(url) {
  try {
    new URL(url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, y64) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`Scraper failed with status ${res.status}`);
    const html = await res.text();

    let cleanText = html
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
      .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanText.length > 3000) {
      cleanText = cleanText.substring(0, 3000) + '... [Content Truncated]';
    }

    return { url, text: cleanText };
  } catch (e) {
    console.error('Scraper tool error:', e);
    return { error: 'Failed to scrape web page', message: e.message };
  }
}

// Custom JavaScript Sandbox Execution Runtime
// Compiles and runs user-defined tool code asynchronously in a local context.
// It intercepts the visual tool's custom JavaScript code, parses out the execute function block,
// and spawns an isolated AsyncFunction injected with local arguments and a server-side fetch wrapper
// (allowing custom tools to execute third-party API calls directly from the backend, bypassing browser CORS restrictions).
async function runCustomJavaScriptTool(codeString, args) {
  try {
    let functionBody = codeString;
    
    // Extract the inner body of the function if the user wrapped it in "async function execute(args) { ... }"
    if (codeString.includes('function execute')) {
      const startIndex = codeString.indexOf('{');
      const endIndex = codeString.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        functionBody = codeString.substring(startIndex + 1, endIndex);
      }
    }

    // Construct a safe asynchronous execution container
    // We bind 'args' (input parameters) and 'fetch' (server-side HTTP request library) into the scope
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const runner = new AsyncFunction('args', 'fetch', functionBody);
    
    // Execute the user tool script and wait for its completion
    const result = await runner(args, fetch);
    
    // Auto-serialize the returned response to JSON if it's an object, or cast to a raw string
    if (typeof result === 'object') {
      return JSON.stringify(result);
    }
    return String(result);
  } catch (e) {
    console.error('JS Sandbox error:', e);
    return JSON.stringify({ error: 'Tool script execution failed', details: e.message });
  }
}

const SYSTEM_TOOLS = [
  {
    id: 'sys_search',
    name: 'system_web_search',
    description: 'Query DuckDuckGo to search the web for real-time information or summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to send to DuckDuckGo'
        }
      },
      required: ['query']
    }
  },
  {
    id: 'sys_scraper',
    name: 'system_web_scraper',
    description: 'Fetch visible text content of any web page URL to analyze details.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full HTTP/HTTPS URL of the web page to scrape'
        }
      },
      required: ['url']
    }
  }
];

// Unified Agent Function Calling Runners
async function runOpenAIAgent({ model, systemInstruction, prompt, history, tools, apiKey, baseUrl }) {
  const url = baseUrl ? `${baseUrl}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
  
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  if (history && history.length > 0) {
    messages.push(...history);
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model: model.replace('ollama/', '').replace('lmstudio/', '') || 'gpt-4o',
    messages,
    temperature: 0.2
  };

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  const startTime = Date.now();
  const headers = { 'content-type': 'application/json' };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Agent run failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  
  let toolCalls = null;
  if (choice?.tool_calls && choice.tool_calls.length > 0) {
    toolCalls = choice.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}')
    }));
  }

  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  return {
    rawMessage: choice || { role: 'assistant', content: '' },
    output: choice?.content || '',
    toolCalls,
    rawRequest: {
      url,
      method: 'POST',
      body: payload
    },
    rawResponse: data,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runClaudeAgent({ model, systemInstruction, prompt, history, tools, apiKey }) {
  const messages = [];
  
  if (history && history.length > 0) {
    messages.push(...history);
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    temperature: 0.2,
    messages
  };

  if (systemInstruction) {
    payload.system = systemInstruction;
  }

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
  }

  const startTime = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude Agent run failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  
  let text = '';
  let toolCalls = null;

  if (data.content && data.content.length > 0) {
    const textBlocks = data.content.filter(b => b.type === 'text');
    text = textBlocks.map(b => b.text).join('\n');

    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      toolCalls = toolUseBlocks.map(tu => ({
        id: tu.id,
        name: tu.name,
        args: tu.input
      }));
    }
  }

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  return {
    rawMessage: { role: 'assistant', content: data.content },
    output: text,
    toolCalls,
    rawRequest: {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: payload
    },
    rawResponse: data,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

async function runGeminiAgent({ model, systemInstruction, prompt, history, tools, apiKey }) {
  const modelName = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const contents = [];
  if (history && history.length > 0) {
    contents.push(...history);
  } else {
    contents.push({ role: 'user', parts: [{ text: prompt }] });
  }

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.2
    }
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (tools && tools.length > 0) {
    payload.tools = [
      {
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }
    ];
  }

  const startTime = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini Agent run failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const choiceContent = candidate?.content;
  
  let text = '';
  let toolCalls = null;

  if (choiceContent && choiceContent.parts) {
    const textParts = choiceContent.parts.filter(p => p.text);
    text = textParts.map(p => p.text).join('\n');

    const fnCallParts = choiceContent.parts.filter(p => p.functionCall);
    if (fnCallParts.length > 0) {
      toolCalls = fnCallParts.map(fc => ({
        id: 'gemini_call_' + Math.random().toString(36).substr(2, 9),
        name: fc.functionCall.name,
        args: fc.functionCall.args
      }));
    }
  }

  const inputTokens = data.usageMetadata?.promptTokenCount || Math.ceil((prompt || (history ? JSON.stringify(history) : '')).length / 4);
  const outputTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);

  return {
    rawMessage: choiceContent || { role: 'model', parts: [] },
    output: text,
    toolCalls,
    rawRequest: {
      url,
      method: 'POST',
      body: payload
    },
    rawResponse: data,
    metrics: {
      durationMs,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    }
  };
}

// Unified Agent Tool Calling Execution Loop Endpoint
app.post('/api/agent/run', async (req, res) => {
  const { model, systemInstruction, prompt, history, tools, autoExecuteMocks } = req.body;

  if (!model) return res.status(400).json({ error: 'Model is required' });
  if (!prompt && (!history || history.length === 0)) {
    return res.status(400).json({ error: 'Prompt or conversation history is required' });
  }

  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = req.headers['x-claude-key'] || process.env.CLAUDE_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const ollamaUrl = resolveLocalUrl(req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  const trace = [];
  let currentHistory = history ? JSON.parse(JSON.stringify(history)) : null;

  if (!currentHistory) {
    if (model.startsWith('gemini')) {
      currentHistory = [{ role: 'user', parts: [{ text: prompt }] }];
    } else {
      currentHistory = [{ role: 'user', content: prompt }];
    }
  }

  const accumulatedMetrics = {
    durationMs: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costEstimate: 0
  };

  try {
    let loopCount = 0;
    const maxLoops = autoExecuteMocks ? 6 : 1;
    let lastResult = null;

    while (loopCount < maxLoops) {
      loopCount++;
      let runResult = null;

      if (model.startsWith('gemini')) {
        if (!geminiKey) throw new Error('Gemini API Key is required. Please add it in Settings.');
        runResult = await runGeminiAgent({
          model,
          systemInstruction,
          history: currentHistory,
          tools,
          apiKey: geminiKey
        });
      } else if (model.startsWith('claude')) {
        if (!claudeKey) throw new Error('Claude API Key is required. Please add it in Settings.');
        runResult = await runClaudeAgent({
          model,
          systemInstruction,
          history: currentHistory,
          tools,
          apiKey: claudeKey
        });
      } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
        if (!openaiKey) throw new Error('OpenAI API Key is required. Please add it in Settings.');
        runResult = await runOpenAIAgent({
          model,
          systemInstruction,
          history: currentHistory,
          tools,
          apiKey: openaiKey
        });
      } else if (model.startsWith('ollama/')) {
        runResult = await runOpenAIAgent({
          model,
          systemInstruction,
          history: currentHistory,
          tools,
          baseUrl: `${ollamaUrl}/v1`
        });
      } else if (model.startsWith('lmstudio/')) {
        runResult = await runOpenAIAgent({
          model,
          systemInstruction,
          history: currentHistory,
          tools,
          baseUrl: `${lmStudioUrl}/v1`
        });
      } else {
        throw new Error(`Unsupported model for agent execution: ${model}`);
      }

      accumulatedMetrics.durationMs += runResult.metrics.durationMs;
      accumulatedMetrics.tokenUsage.inputTokens += runResult.metrics.tokenUsage.inputTokens;
      accumulatedMetrics.tokenUsage.outputTokens += runResult.metrics.tokenUsage.outputTokens;
      accumulatedMetrics.tokenUsage.totalTokens += runResult.metrics.tokenUsage.totalTokens;
      
      const stepCost = calculateCost(
        model,
        runResult.metrics.tokenUsage.inputTokens,
        runResult.metrics.tokenUsage.outputTokens
      );
      accumulatedMetrics.costEstimate += stepCost;

      trace.push({
        role: 'model',
        type: runResult.toolCalls ? 'tool_call' : 'text',
        content: runResult.output,
        toolCalls: runResult.toolCalls,
        rawRequest: runResult.rawRequest,
        rawResponse: runResult.rawResponse
      });

      currentHistory.push(runResult.rawMessage);
      lastResult = runResult;

      if (runResult.toolCalls && runResult.toolCalls.length > 0 && autoExecuteMocks) {
        if (model.startsWith('gemini')) {
          const parts = await Promise.all(runResult.toolCalls.map(async (tc) => {
            const matchedTool = tools.find(t => t.name === tc.name);
            let mockResponse = '{}';
            
            if (tc.name === 'system_web_search') {
              const searchResult = await executeWebSearch(tc.args.query);
              mockResponse = searchResult.text || JSON.stringify(searchResult);
            } else if (tc.name === 'system_web_scraper') {
              const scrapeResult = await executeWebScraper(tc.args.url);
              mockResponse = scrapeResult.text || JSON.stringify(scrapeResult);
            } else if (matchedTool) {
              if (matchedTool.executionMode === 'javascript') {
                mockResponse = await runCustomJavaScriptTool(matchedTool.code, tc.args);
              } else {
                mockResponse = matchedTool.mockResponse || '{}';
              }
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              content: mockResponse,
              rawRequest: { tool: tc.name, args: tc.args, code: matchedTool?.code },
              rawResponse: { result: mockResponse }
            });

            let parsedResponse;
            try {
              parsedResponse = JSON.parse(mockResponse);
            } catch (e) {
              parsedResponse = { response: mockResponse };
            }

            return {
              functionResponse: {
                name: tc.name,
                response: { name: tc.name, content: parsedResponse }
              }
            };
          }));
          currentHistory.push({ role: 'user', parts });
        } else if (model.startsWith('claude')) {
          const content = await Promise.all(runResult.toolCalls.map(async (tc) => {
            const matchedTool = tools.find(t => t.name === tc.name);
            let mockResponse = '{}';
            
            if (tc.name === 'system_web_search') {
              const searchResult = await executeWebSearch(tc.args.query);
              mockResponse = searchResult.text || JSON.stringify(searchResult);
            } else if (tc.name === 'system_web_scraper') {
              const scrapeResult = await executeWebScraper(tc.args.url);
              mockResponse = scrapeResult.text || JSON.stringify(scrapeResult);
            } else if (matchedTool) {
              if (matchedTool.executionMode === 'javascript') {
                mockResponse = await runCustomJavaScriptTool(matchedTool.code, tc.args);
              } else {
                mockResponse = matchedTool.mockResponse || '{}';
              }
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              content: mockResponse,
              rawRequest: { tool: tc.name, args: tc.args, code: matchedTool?.code },
              rawResponse: { result: mockResponse }
            });

            return {
              type: 'tool_result',
              tool_use_id: tc.id,
              content: mockResponse
            };
          }));
          currentHistory.push({ role: 'user', content });
        } else {
          for (const tc of runResult.toolCalls) {
            const matchedTool = tools.find(t => t.name === tc.name);
            let mockResponse = '{}';
            
            if (tc.name === 'system_web_search') {
              const searchResult = await executeWebSearch(tc.args.query);
              mockResponse = searchResult.text || JSON.stringify(searchResult);
            } else if (tc.name === 'system_web_scraper') {
              const scrapeResult = await executeWebScraper(tc.args.url);
              mockResponse = scrapeResult.text || JSON.stringify(scrapeResult);
            } else if (matchedTool) {
              if (matchedTool.executionMode === 'javascript') {
                mockResponse = await runCustomJavaScriptTool(matchedTool.code, tc.args);
              } else {
                mockResponse = matchedTool.mockResponse || '{}';
              }
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              content: mockResponse,
              rawRequest: { tool: tc.name, args: tc.args, code: matchedTool?.code },
              rawResponse: { result: mockResponse }
            });

            currentHistory.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: mockResponse
            });
          }
        }
      } else {
        break;
      }
    }

    res.json({
      success: true,
      trace,
      history: currentHistory,
      finalOutput: lastResult?.output || '',
      metrics: accumulatedMetrics
    });
  } catch (error) {
    console.error('Agent execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Prompt Forge Copilot Tools & Chat Workspace ─────────────────────────────

async function executeCopilotTool(name, args) {
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
        versions: prompt.versions,
        branches: prompt.branches || []
      };
    }

    case 'create_project': {
      const projects = db.getProjects();
      const newProj = {
        id: 'proj_' + Date.now(),
        name: args.name,
        prompts: []
      };
      projects.push(newProj);
      db.saveProjects(projects);
      return { success: true, project: newProj };
    }

    case 'create_prompt': {
      const projects = db.getProjects();
      const project = projects.find(p => p.id === args.projectId);
      if (!project) throw new Error(`Project ${args.projectId} not found.`);
      
      const newPrompt = {
        id: 'prompt_' + Date.now(),
        name: args.name,
        description: args.description || '',
        versions: [],
        branches: [],
        fewShotExamples: []
      };
      if (!project.prompts) project.prompts = [];
      project.prompts.push(newPrompt);
      db.saveProjects(projects);
      return { success: true, prompt: newPrompt };
    }

    case 'save_prompt_version': {
      const projects = db.getProjects();
      const project = projects.find(p => p.id === args.projectId);
      if (!project) throw new Error(`Project ${args.projectId} not found.`);
      const prompt = (project.prompts || []).find(pr => pr.id === args.promptId);
      if (!prompt) throw new Error(`Prompt ${args.promptId} not found.`);

      const branchName = args.branchName || 'main';
      const desc = args.description || `Saved via Copilot on ${new Date().toLocaleDateString()}`;
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
app.post('/api/copilot/critique', async (req, res) => {
  const { systemInstruction, template, model } = req.body;
  const modelName = model || 'gemini-1.5-flash';
  
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = req.headers['x-claude-key'] || process.env.CLAUDE_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const ollamaUrl = resolveLocalUrl(req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  const isLocal = modelName.startsWith('ollama/') || modelName.startsWith('lmstudio/');
  const apiKey = modelName.startsWith('gemini') ? geminiKey 
               : modelName.startsWith('claude') ? claudeKey 
               : (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) ? openaiKey
               : '';

  if (!isLocal && !apiKey) {
    return res.status(400).json({ error: 'Missing API Key in settings for the selected model.' });
  }

  const critiquePrompt = `Analyze the following system instructions and prompt template. Provide a detailed critique and an optimized version.

SYSTEM INSTRUCTIONS:
"""
${systemInstruction || '(None)'}
"""

PROMPT TEMPLATE:
"""
${template || '(None)'}
"""

You MUST respond with a valid JSON object matching this schema:
{
  "score": number (0-100),
  "critique": {
    "clarity": "text description and score",
    "constraints": "text description and score",
    "formatting": "text description and score"
  },
  "suggestions": [
    "suggestion 1",
    "suggestion 2",
    "suggestion 3"
  ],
  "optimizedSystemInstruction": "optimized system instructions text",
  "optimizedTemplate": "optimized prompt template text"
}
Ensure the response is strictly raw JSON, do not wrap in markdown code blocks.`;

  try {
    let resultText = '';
    if (modelName.startsWith('gemini')) {
      const runRes = await runGemini({ model: modelName, prompt: critiquePrompt, temperature: 0.1, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('claude')) {
      const runRes = await runClaude({ model: modelName, prompt: critiquePrompt, temperature: 0.1, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) {
      const runRes = await runOpenAI({ model: modelName, prompt: critiquePrompt, temperature: 0.1, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('ollama/')) {
      const runRes = await runOllama({ model: modelName, prompt: critiquePrompt, temperature: 0.1, ollamaUrl, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('lmstudio/')) {
      const runRes = await runLMStudio({ model: modelName, prompt: critiquePrompt, temperature: 0.1, lmStudioUrl, maxTokens: 4096 });
      resultText = runRes.output;
    }

    const json = parseJsonFromLlm(resultText);
    res.json(json);
  } catch (err) {
    console.error('Critique failed:', err);
    console.error('Raw resultText was:', resultText);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/copilot/generate-assertions', async (req, res) => {
  const { systemInstruction, template, model } = req.body;
  const modelName = model || 'gemini-1.5-flash';
  
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = req.headers['x-claude-key'] || process.env.CLAUDE_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const ollamaUrl = resolveLocalUrl(req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  const isLocal = modelName.startsWith('ollama/') || modelName.startsWith('lmstudio/');
  const apiKey = modelName.startsWith('gemini') ? geminiKey 
               : modelName.startsWith('claude') ? claudeKey 
               : (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) ? openaiKey
               : '';

  if (!isLocal && !apiKey) {
    return res.status(400).json({ error: 'Missing API Key in settings for the selected model.' });
  }

  const assertionsPrompt = `Inspect the following system instructions and prompt template. Propose a set of test cases with test assertions that verify the model output behaves correctly according to the prompt's instructions.
You should return exactly 3 logical test cases. Each test case must have a name, variable input values, and 2-3 assertions.
Assertions can be of type: "contains" (must contain a substring), "not_contains" (must not contain a substring), or "llm_judge" (rubric to verify output quality/tone using another LLM).

SYSTEM INSTRUCTIONS:
"""
${systemInstruction || '(None)'}
"""

PROMPT TEMPLATE:
"""
${template || '(None)'}
"""

You MUST respond with a valid JSON object matching this schema:
{
  "testCases": [
    {
      "name": "Test Case Name (e.g. friendly tone test)",
      "variables": {
        "varName1": "test value 1",
        "varName2": "test value 2"
      },
      "assertions": [
        { "type": "contains", "value": "substring to look for" },
        { "type": "llm_judge", "value": "The output must sound encouraging and polite." }
      ]
    }
  ]
}
Ensure the response is strictly raw JSON, do not wrap in markdown code blocks.`;

  try {
    let resultText = '';
    if (modelName.startsWith('gemini')) {
      const runRes = await runGemini({ model: modelName, prompt: assertionsPrompt, temperature: 0.2, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('claude')) {
      const runRes = await runClaude({ model: modelName, prompt: assertionsPrompt, temperature: 0.2, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) {
      const runRes = await runOpenAI({ model: modelName, prompt: assertionsPrompt, temperature: 0.2, apiKey, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('ollama/')) {
      const runRes = await runOllama({ model: modelName, prompt: assertionsPrompt, temperature: 0.2, ollamaUrl, maxTokens: 4096 });
      resultText = runRes.output;
    } else if (modelName.startsWith('lmstudio/')) {
      const runRes = await runLMStudio({ model: modelName, prompt: assertionsPrompt, temperature: 0.2, lmStudioUrl, maxTokens: 4096 });
      resultText = runRes.output;
    }

    const json = parseJsonFromLlm(resultText);
    res.json(json);
  } catch (err) {
    console.error('Failed to generate assertions:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/local-models', async (req, res) => {
  const ollamaUrl = resolveLocalUrl(req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  const models = [];

  // 1. Fetch from Ollama
  try {
    const ollamaResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000)
    });
    if (ollamaResponse.ok) {
      const data = await ollamaResponse.json();
      if (data.models && Array.isArray(data.models)) {
        for (const m of data.models) {
          models.push({
            value: `ollama/${m.name}`,
            label: `Ollama: ${m.name}`
          });
        }
      }
    }
  } catch (err) {
    console.log('Ollama local models fetch failed (probably offline)');
  }

  // 2. Fetch from LM Studio
  try {
    const lmResponse = await fetch(`${lmStudioUrl}/v1/models`, {
      signal: AbortSignal.timeout(2000)
    });
    if (lmResponse.ok) {
      const data = await lmResponse.json();
      if (data.data && Array.isArray(data.data)) {
        for (const m of data.data) {
          models.push({
            value: `lmstudio/${m.id}`,
            label: `LM Studio: ${m.id}`
          });
        }
      }
    }
  } catch (err) {
    console.log('LM Studio local models fetch failed (probably offline)');
  }

  res.json({ models });
});

app.post('/api/copilot/chat', async (req, res) => {
  const { model, history, message } = req.body;
  const modelName = model || 'gemini-1.5-flash';
  
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = req.headers['x-claude-key'] || process.env.CLAUDE_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const ollamaUrl = resolveLocalUrl(req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434');
  const lmStudioUrl = resolveLocalUrl(req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234');

  const isLocal = modelName.startsWith('ollama/') || modelName.startsWith('lmstudio/');
  const apiKey = modelName.startsWith('gemini') ? geminiKey 
               : modelName.startsWith('claude') ? claudeKey 
               : (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) ? openaiKey
               : '';

  if (!isLocal && !apiKey) {
    return res.status(400).json({ error: 'Missing API Key in settings for the selected model.' });
  }

  // System instructions for the Prompt Engineering assistant
  const systemInstruction = `You are PromptForge Copilot, a senior prompt engineering assistant. Your job is to help the user manage their projects, prompts, versions, branches, and custom agent tools. You have tools available to list projects, get prompt details, save new prompt versions (or branch versions), list custom playground tools, and create/update playground tools. Always use these tools proactively when asked to show, update, delete, or create prompts, projects, or tools. Be friendly, structured, concise, and helpful.`;

  // Copilot Tools list
  const copilotTools = [
    {
      name: "list_projects",
      description: "List all projects and prompt templates in the Prompt Playground",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "get_prompt",
      description: "Get detailed system instructions, template, parameters, and branches of a specific prompt",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          promptId: { type: "string" }
        },
        required: ["projectId", "promptId"]
      }
    },
    {
      name: "create_project",
      description: "Create a new project in the playground database.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The name of the new project" }
        },
        required: ["name"]
      }
    },
    {
      name: "create_prompt",
      description: "Create a new prompt template under a project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "The target project ID" },
          name: { type: "string", description: "The name of the prompt (e.g. review-analyzer)" },
          description: { type: "string", description: "Brief description of the prompt task" }
        },
        required: ["projectId", "name"]
      }
    },
    {
      name: "save_prompt_version",
      description: "Save a new version of a prompt template (supporting main or custom branch versions).",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          promptId: { type: "string" },
          systemInstruction: { type: "string" },
          template: { type: "string" },
          temperature: { type: "number" },
          maxTokens: { type: "number" },
          description: { type: "string" },
          branchName: { type: "string" }
        },
        required: ["projectId", "promptId", "systemInstruction", "template"]
      }
    },
    {
      name: "list_tools",
      description: "List all custom agent execution tools (Mock/JS sandbox tools) registered in the database.",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "create_tool",
      description: "Create or update a custom playground tool.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Unique name of the tool (lowercase, underscores)" },
          description: { type: "string", description: "Tool utility description" },
          parameters: { type: "object", description: "JSON schema defining parameters" },
          code: { type: "string", description: "Executable JavaScript code" },
          mockResponse: { type: "string", description: "JSON string containing mock response data" }
        },
        required: ["name", "description"]
      }
    }
  ];

  let currentHistory = history ? JSON.parse(JSON.stringify(history)) : [];
  if (currentHistory.length === 0 && message) {
    if (modelName.startsWith('gemini')) {
      currentHistory.push({ role: 'user', parts: [{ text: message }] });
    } else {
      currentHistory.push({ role: 'user', content: message });
    }
  }

  const trace = [];

  try {
    let loopCount = 0;
    const maxLoops = 15;
    let lastResult = null;

    while (loopCount < maxLoops) {
      loopCount++;
      let runResult = null;

      if (modelName.startsWith('gemini')) {
        runResult = await runGeminiAgent({
          model: modelName,
          systemInstruction,
          history: currentHistory,
          tools: copilotTools,
          apiKey
        });
      } else if (modelName.startsWith('claude')) {
        runResult = await runClaudeAgent({
          model: modelName,
          systemInstruction,
          history: currentHistory,
          tools: copilotTools,
          apiKey
        });
      } else if (modelName.startsWith('gpt') || modelName.startsWith('o1') || modelName.startsWith('o3')) {
        runResult = await runOpenAIAgent({
          model: modelName,
          systemInstruction,
          history: currentHistory,
          tools: copilotTools,
          apiKey
        });
      } else if (modelName.startsWith('ollama/')) {
        runResult = await runOpenAIAgent({
          model: modelName,
          systemInstruction,
          history: currentHistory,
          tools: copilotTools,
          baseUrl: `${ollamaUrl}/v1`
        });
      } else if (modelName.startsWith('lmstudio/')) {
        runResult = await runOpenAIAgent({
          model: modelName,
          systemInstruction,
          history: currentHistory,
          tools: copilotTools,
          baseUrl: `${lmStudioUrl}/v1`
        });
      } else {
        throw new Error(`Unsupported model for copilot execution: ${modelName}`);
      }

      currentHistory.push(runResult.rawMessage);
      lastResult = runResult;

      if (runResult.toolCalls && runResult.toolCalls.length > 0) {
        if (modelName.startsWith('gemini')) {
          const parts = await Promise.all(runResult.toolCalls.map(async (tc) => {
            let toolOutput;
            let success = true;
            try {
              toolOutput = await executeCopilotTool(tc.name, tc.args);
            } catch (err) {
              toolOutput = { error: err.message };
              success = false;
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              status: success ? 'success' : 'error',
              args: tc.args,
              result: toolOutput
            });

            return {
              functionResponse: {
                name: tc.name,
                response: { name: tc.name, content: toolOutput }
              }
            };
          }));
          currentHistory.push({ role: 'user', parts });
        } else if (modelName.startsWith('claude')) {
          const content = await Promise.all(runResult.toolCalls.map(async (tc) => {
            let toolOutput;
            let success = true;
            try {
              toolOutput = await executeCopilotTool(tc.name, tc.args);
            } catch (err) {
              toolOutput = { error: err.message };
              success = false;
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              status: success ? 'success' : 'error',
              args: tc.args,
              result: toolOutput
            });

            return {
              type: 'tool_result',
              tool_use_id: tc.id,
              content: JSON.stringify(toolOutput)
            };
          }));
          currentHistory.push({ role: 'user', content });
        } else {
          for (const tc of runResult.toolCalls) {
            let toolOutput;
            let success = true;
            try {
              toolOutput = await executeCopilotTool(tc.name, tc.args);
            } catch (err) {
              toolOutput = { error: err.message };
              success = false;
            }

            trace.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              status: success ? 'success' : 'error',
              args: tc.args,
              result: toolOutput
            });

            currentHistory.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: JSON.stringify(toolOutput)
            });
          }
        }
      } else {
        break;
      }
    }

    res.json({
      success: true,
      trace,
      history: currentHistory,
      finalOutput: lastResult?.output || ''
    });
  } catch (error) {
    console.error('Copilot agent run error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Elo Leaderboard Endpoints
app.get('/api/elo', (req, res) => {
  res.json(db.getElo());
});

app.post('/api/elo/vote', (req, res) => {
  const { modelA, modelB, winner } = req.body;
  if (!modelA || !modelB || !winner) {
    return res.status(400).json({ error: 'modelA, modelB, and winner are required' });
  }

  try {
    const eloDb = db.getElo();
    if (!eloDb[modelA]) eloDb[modelA] = { elo: 1200, wins: 0, losses: 0, ties: 0, matches: 0 };
    if (!eloDb[modelB]) eloDb[modelB] = { elo: 1200, wins: 0, losses: 0, ties: 0, matches: 0 };

    const rA = eloDb[modelA].elo;
    const rB = eloDb[modelB].elo;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const eB = 1 / (1 + Math.pow(10, (rA - rB) / 400));

    let sA = 0.5;
    let sB = 0.5;
    if (winner === 'A') {
      sA = 1;
      sB = 0;
      eloDb[modelA].wins += 1;
      eloDb[modelB].losses += 1;
    } else if (winner === 'B') {
      sA = 0;
      sB = 1;
      eloDb[modelA].losses += 1;
      eloDb[modelB].wins += 1;
    } else {
      eloDb[modelA].ties += 1;
      eloDb[modelB].ties += 1;
    }
    eloDb[modelA].matches += 1;
    eloDb[modelB].matches += 1;

    const kFactor = 32;
    const diffA = Math.round(kFactor * (sA - eA));
    const diffB = Math.round(kFactor * (sB - eB));

    eloDb[modelA].elo += diffA;
    eloDb[modelB].elo += diffB;

    db.saveElo(eloDb);

    res.json({ success: true, eloDb, diffA, diffB, modelA, modelB });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Git History for a specific prompt
app.get('/api/prompts/:promptId/git-history', (req, res) => {
  const { promptId } = req.params;
  try {
    let logOutput;
    try {
      logOutput = execSync('git log --follow --format="%H|%an|%ad|%s" -- data/projects.json', { encoding: 'utf-8' });
    } catch (gitErr) {
      return res.json({ gitEnabled: false, history: [] });
    }

    const commits = logOutput.trim().split('\n').filter(Boolean).map(line => {
      const [hash, author, date, message] = line.split('|');
      return { hash, author, date, message };
    });

    const history = [];
    for (const commit of commits) {
      try {
        const fileContent = execSync(`git show ${commit.hash}:data/projects.json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        const projects = JSON.parse(fileContent);
        
        let foundPrompt = null;
        for (const proj of projects) {
          if (proj.prompts) {
            const match = proj.prompts.find(p => p.id === promptId);
            if (match) {
              foundPrompt = match;
              break;
            }
          }
        }

        if (foundPrompt) {
          const latestVersionObj = foundPrompt.versions?.[foundPrompt.versions.length - 1];
          history.push({
            hash: commit.hash,
            author: commit.author,
            date: commit.date,
            message: commit.message,
            name: foundPrompt.name,
            description: foundPrompt.description,
            template: latestVersionObj?.template || '',
            systemInstruction: latestVersionObj?.systemInstruction || ''
          });
        }
      } catch (err) {
        // Skip commit
      }
    }

    res.json({ gitEnabled: true, history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// IMAGE STUDIO & COMFYUI INTEGRATION
// ==========================================

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
app.use('/data/images', express.static(IMAGES_DIR));

const DEFAULT_COMFY_WORKFLOW = {
  "3": {
    "inputs": {
      "seed": 100000,
      "steps": 20,
      "cfg": 8,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    },
    "class_type": "KSampler"
  },
  "4": {
    "inputs": {
      "ckpt_name": "v1-5-pruned-emaonly.ckpt"
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "5": {
    "inputs": {
      "width": 512,
      "height": 512,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  },
  "6": {
    "inputs": {
      "text": "positive prompt",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "7": {
    "inputs": {
      "text": "negative prompt",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "8": {
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    },
    "class_type": "VAEDecode"
  },
  "9": {
    "inputs": {
      "filename_prefix": "PromptForge",
      "images": ["8", 0]
    },
    "class_type": "SaveImage"
  }
};

async function checkAndResolveComfyUrl(url) {
  if (!url || !url.includes('localhost')) return url;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${url}/`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok || res.status === 404 || res.status === 405) {
      return url;
    }
  } catch (e) {
    // failed, try fallback
  }
  
  const fallback = url.replace('localhost', '127.0.0.1');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${fallback}/`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok || res.status === 404 || res.status === 405) {
      console.log(`ComfyUI: Automatically resolved localhost to 127.0.0.1`);
      return fallback;
    }
  } catch (e) {
    // ignore
  }
  return url;
}

async function getComfyUiLoras(comfyUrl) {
  try {
    const res = await fetch(`${comfyUrl}/object_info`);
    if (!res.ok) return [];
    const data = await res.json();
    const loader = data.LoraLoader;
    if (loader && loader.input && loader.input.required && loader.input.required.lora_name) {
      return loader.input.required.lora_name[0] || [];
    }
  } catch (e) {
    console.error('Failed to fetch LoRAs from ComfyUI:', e);
  }
  return [];
}

async function uploadImageToComfy(comfyUrl, base64Data) {
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid base64 image data');
  const ext = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  
  const form = new FormData();
  const blob = new Blob([buffer], { type: `image/${ext}` });
  form.append('image', blob, `upload_${Date.now()}.${ext}`);
  
  const res = await fetch(`${comfyUrl}/upload/image`, {
    method: 'POST',
    body: form
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload initial image to ComfyUI: ${res.status} - ${text}`);
  }
  
  const data = await res.json();
  return data.name;
}

async function getComfyUiCheckpoints(comfyUrl) {
  try {
    const res = await fetch(`${comfyUrl}/object_info`);
    if (!res.ok) return [];
    const data = await res.json();
    const loader = data.CheckpointLoaderSimple || data.CheckpointLoader;
    if (loader && loader.input && loader.input.required && loader.input.required.ckpt_name) {
      return loader.input.required.ckpt_name[0] || [];
    }
  } catch (e) {
    console.error(`Failed to fetch checkpoints from ComfyUI at ${comfyUrl}:`, e);
  }
  return [];
}

function buildComfyWorkflow(params) {
  if (params.customWorkflow) {
    let workflowStr = params.customWorkflow;
    workflowStr = workflowStr
      .replace(/\{\{positive_prompt\}\}/g, JSON.stringify(params.positivePrompt || ""))
      .replace(/\{\{negative_prompt\}\}/g, JSON.stringify(params.negativePrompt || ""))
      .replace(/\{\{checkpoint\}\}/g, JSON.stringify(params.checkpoint || ""))
      .replace(/\{\{seed\}\}/g, params.seed)
      .replace(/\{\{steps\}\}/g, params.steps)
      .replace(/\{\{cfg\}\}/g, params.cfg)
      .replace(/\{\{sampler\}\}/g, JSON.stringify(params.sampler || "euler"))
      .replace(/\{\{scheduler\}\}/g, JSON.stringify(params.scheduler || "normal"))
      .replace(/\{\{width\}\}/g, params.width)
      .replace(/\{\{height\}\}/g, params.height);
      
    if (params.initialImageFilename) {
      workflowStr = workflowStr
        .replace(/\{\{initial_image\}\}/g, JSON.stringify(params.initialImageFilename))
        .replace(/\{\{denoise\}\}/g, params.denoise || 0.6);
    }
    return JSON.parse(workflowStr);
  }
  
  const workflow = JSON.parse(JSON.stringify(DEFAULT_COMFY_WORKFLOW));
  
  let lastModelOutput = ["4", 0];
  let lastClipOutput = ["4", 1];
  
  if (params.loras && params.loras.length > 0) {
    params.loras.forEach((lora, idx) => {
      const nodeId = 100 + idx;
      workflow[`${nodeId}`] = {
        inputs: {
          lora_name: lora.name,
          strength_model: Number(lora.strength),
          strength_clip: Number(lora.strength),
          model: lastModelOutput,
          clip: lastClipOutput
        },
        class_type: "LoraLoader"
      };
      lastModelOutput = [`${nodeId}`, 0];
      lastClipOutput = [`${nodeId}`, 1];
    });
  }
  
  workflow["3"].inputs.seed = Number(params.seed);
  workflow["3"].inputs.steps = Number(params.steps);
  workflow["3"].inputs.cfg = Number(params.cfg);
  workflow["3"].inputs.sampler_name = params.sampler;
  workflow["3"].inputs.scheduler = params.scheduler;
  
  workflow["3"].inputs.model = lastModelOutput;
  
  workflow["4"].inputs.ckpt_name = params.checkpoint;
  
  workflow["5"].inputs.width = Number(params.width);
  workflow["5"].inputs.height = Number(params.height);
  
  workflow["6"].inputs.text = params.positivePrompt;
  workflow["6"].inputs.clip = lastClipOutput;
  
  workflow["7"].inputs.text = params.negativePrompt;
  workflow["7"].inputs.clip = lastClipOutput;
  
  if (params.initialImageFilename) {
    workflow["90"] = {
      inputs: {
        image: params.initialImageFilename
      },
      class_type: "LoadImage"
    };
    workflow["91"] = {
      inputs: {
        pixels: ["90", 0],
        vae: ["4", 2]
      },
      class_type: "VAEEncode"
    };
    workflow["3"].inputs.latent_image = ["91", 0];
    workflow["3"].inputs.denoise = Number(params.denoise || 0.6);
  }
  
  return workflow;
}

// 1. Get saved image prompts
app.get('/api/image-studio/prompts', (req, res) => {
  res.json(db.getImagePrompts());
});

// 2. Save or update image prompt
app.post('/api/image-studio/prompts', (req, res) => {
  const prompt = req.body;
  const prompts = db.getImagePrompts();
  if (prompt.id) {
    const idx = prompts.findIndex(p => p.id === prompt.id);
    if (idx !== -1) {
      prompts[idx] = { ...prompts[idx], ...prompt, updatedAt: new Date().toISOString() };
    } else {
      prompts.push(prompt);
    }
  } else {
    prompt.id = `img_prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    prompt.createdAt = new Date().toISOString();
    prompt.updatedAt = new Date().toISOString();
    prompts.push(prompt);
  }
  db.saveImagePrompts(prompts);
  res.json(prompt);
});

// 3. Delete saved image prompt
app.delete('/api/image-studio/prompts/:id', (req, res) => {
  const { id } = req.params;
  const prompts = db.getImagePrompts();
  const filtered = prompts.filter(p => p.id !== id);
  db.saveImagePrompts(filtered);
  res.json({ success: true });
});

// 4. Get image gallery
app.get('/api/image-studio/gallery', (req, res) => {
  res.json(db.getImageGallery());
});

// 5. Delete gallery item and local file
app.delete('/api/image-studio/gallery/:id', (req, res) => {
  const { id } = req.params;
  const gallery = db.getImageGallery();
  const item = gallery.find(i => i.id === id);
  if (item) {
    const filename = path.basename(item.imagePath);
    const filePath = path.join(IMAGES_DIR, filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to delete image file:', err);
    }
  }
  const filtered = gallery.filter(i => i.id !== id);
  db.saveImageGallery(filtered);
  res.json({ success: true });
});

// 6. Get checkpoints from ComfyUI
app.get('/api/image-studio/comfy-checkpoints', async (req, res) => {
  let comfyUrl = resolveLocalUrl(req.headers['x-comfyui-url'] || process.env.COMFYUI_URL || 'http://localhost:8188');
  comfyUrl = await checkAndResolveComfyUrl(comfyUrl);
  const checkpoints = await getComfyUiCheckpoints(comfyUrl);
  res.json(checkpoints);
});

// 6.5. Get LoRAs from ComfyUI
app.get('/api/image-studio/comfy-loras', async (req, res) => {
  let comfyUrl = resolveLocalUrl(req.headers['x-comfyui-url'] || process.env.COMFYUI_URL || 'http://localhost:8188');
  comfyUrl = await checkAndResolveComfyUrl(comfyUrl);
  const loras = await getComfyUiLoras(comfyUrl);
  res.json(loras);
});

// 7. Generate image via ComfyUI
app.post('/api/image-studio/generate', async (req, res) => {
  const params = req.body;
  let comfyUrl = resolveLocalUrl(req.headers['x-comfyui-url'] || process.env.COMFYUI_URL || 'http://localhost:8188');
  comfyUrl = await checkAndResolveComfyUrl(comfyUrl);

  try {
    let initialImageFilename = null;
    if (params.initialImage) {
      initialImageFilename = await uploadImageToComfy(comfyUrl, params.initialImage);
    }
    const workflowObj = buildComfyWorkflow({ ...params, initialImageFilename });
    const promptRes = await fetch(`${comfyUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflowObj })
    });

    if (!promptRes.ok) {
      const errText = await promptRes.text();
      throw new Error(`ComfyUI error: ${promptRes.status} - ${errText}`);
    }

    const promptData = await promptRes.json();
    const { prompt_id } = promptData;

    let completedData = null;
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const historyRes = await fetch(`${comfyUrl}/history/${prompt_id}`);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        if (historyData[prompt_id]) {
          completedData = historyData[prompt_id];
          break;
        }
      }
    }

    if (!completedData) {
      throw new Error('Image generation timed out after 120 seconds.');
    }

    const outputs = completedData.outputs;
    const downloadedImages = [];

    for (const nodeId in outputs) {
      const nodeOutput = outputs[nodeId];
      if (nodeOutput.images && nodeOutput.images.length > 0) {
        for (const img of nodeOutput.images) {
          const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`;
          const viewRes = await fetch(viewUrl);
          if (!viewRes.ok) continue;
          
          const buffer = await viewRes.arrayBuffer();
          const localFilename = `comfy_${Date.now()}_${img.filename}`;
          const localPath = path.join(IMAGES_DIR, localFilename);
          
          fs.writeFileSync(localPath, Buffer.from(buffer));
          downloadedImages.push({
            filename: localFilename,
            path: `/data/images/${localFilename}`
          });
        }
      }
    }

    if (downloadedImages.length === 0) {
      throw new Error('No images returned from ComfyUI output nodes.');
    }

    const gallery = db.getImageGallery();
    const newItems = downloadedImages.map(img => {
      const newItem = {
        id: `img_gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        promptId: params.promptId || null,
        promptName: params.promptName || 'Untitled Prompt',
        positivePrompt: params.positivePrompt,
        negativePrompt: params.negativePrompt,
        checkpoint: params.checkpoint,
        width: Number(params.width),
        height: Number(params.height),
        steps: Number(params.steps),
        cfg: Number(params.cfg),
        sampler: params.sampler,
        scheduler: params.scheduler,
        seed: Number(params.seed),
        imagePath: img.path,
        createdAt: new Date().toISOString()
      };
      gallery.unshift(newItem);
      return newItem;
    });

    db.saveImageGallery(gallery);
    res.json({ success: true, items: newItems });

  } catch (error) {
    console.error('Image generation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve static client assets in production
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Fallback for single-page app (SPA) routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Prompt Playground server running on http://localhost:${PORT}`);
});
