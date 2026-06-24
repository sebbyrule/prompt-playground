import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

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
    inputTokens = Math.ceil(prompt.length / 4);
    outputTokens = Math.ceil(text.length / 4);
  }

  return {
    output: text,
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

  return {
    output: text,
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

  return {
    output: text,
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

  return {
    output: text,
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

  return {
    output: text,
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
  const ollamaUrl = headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434';
  const lmStudioUrl = headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234';

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
    const result = JSON.parse(text);
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
                const judgeResult = JSON.parse(judgeResponse.response.text());
                
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
  const { id, skillId, name, messages, metrics } = req.body;
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

// Custom JavaScript Sandbox Execution
async function runCustomJavaScriptTool(codeString, args) {
  try {
    let functionBody = codeString;
    if (codeString.includes('function execute')) {
      const startIndex = codeString.indexOf('{');
      const endIndex = codeString.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        functionBody = codeString.substring(startIndex + 1, endIndex);
      }
    }

    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const runner = new AsyncFunction('args', 'fetch', functionBody);
    const result = await runner(args, fetch);
    
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
    rawMessage: choice,
    output: choice?.content || '',
    toolCalls,
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

  const inputTokens = data.usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
  const outputTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);

  return {
    rawMessage: choiceContent || { role: 'model', parts: [] },
    output: text,
    toolCalls,
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
  const ollamaUrl = req.headers['x-ollama-url'] || process.env.OLLAMA_URL || 'http://localhost:11434';
  const lmStudioUrl = req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234';

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
        toolCalls: runResult.toolCalls
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
              content: mockResponse
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
              content: mockResponse
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
              content: mockResponse
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

app.listen(PORT, () => {
  console.log(`Prompt Playground server running on http://localhost:${PORT}`);
});
