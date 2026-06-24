import React, { useState, useEffect } from 'react';
import './AgentWorkspace.css';
import api from '../utils/api';
import { 
  Play, 
  Trash2, 
  Cpu, 
  Wrench, 
  PlusCircle, 
  AlertCircle, 
  Clock, 
  TrendingUp, 
  Send, 
  HelpCircle, 
  Sparkles,
  Plus,
  RotateCcw
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: { [key: string]: { type: string; description: string } };
    required: string[];
  };
  mockResponse: string;
  executionMode: 'mock' | 'javascript';
  code: string;
  createdAt: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  systemInstruction: string;
  tools: string[]; // List of Tool IDs
  createdAt: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'model' | 'tool' | 'system';
  content?: string | any[];
  text?: string; // fallback
  parts?: any[];
  tool_calls?: any[];
  toolCallId?: string;
  tool_call_id?: string;
  name?: string;
}

interface ChatSession {
  id: string;
  skillId: string;
  name: string;
  messages: ChatMessage[];
  trace: any[]; // Full simulation log of events
  metrics: {
    durationMs: number;
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
    costEstimate: number;
  } | null;
  updatedAt: string;
}

const SYSTEM_TOOLS = [
  {
    id: 'system_web_search',
    name: 'system_web_search',
    description: 'Query DuckDuckGo search to retrieve snippets of real-time web information.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  },
  {
    id: 'system_web_scraper',
    name: 'system_web_scraper',
    description: 'Fetch the visible visible text summary of a web page URL.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Web page URL to scrape'
        }
      },
      required: ['url']
    }
  }
];

const JS_TEMPLATE = `async function execute(args) {
  // Use args.<parameter_name> to fetch arguments
  // You can fetch live APIs using the global fetch wrapper:
  // const res = await fetch('https://api.github.com');
  // const data = await res.json();
  
  return { 
    status: "success", 
    message: "Hello from sandbox!" 
  };
}`;

export const AgentWorkspace: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<'tools' | 'skills' | 'tester'>('tools');

  // DB States
  const [tools, setTools] = useState<Tool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Tools Form States
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolExecutionMode, setToolExecutionMode] = useState<'mock' | 'javascript'>('mock');
  const [toolCode, setToolCode] = useState(JS_TEMPLATE);
  const [toolMockResponse, setToolMockResponse] = useState('{}');
  const [toolParams, setToolParams] = useState<ToolParameter[]>([]);
  const [newParamName, setNewParamName] = useState('');
  const [newParamType, setNewParamType] = useState<ToolParameter['type']>('string');
  const [newParamDesc, setNewParamDesc] = useState('');
  const [newParamRequired, setNewParamRequired] = useState(false);

  // Skills Form States
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillSystemInstruction, setSkillSystemInstruction] = useState('');
  const [skillSelectedTools, setSkillSelectedTools] = useState<string[]>([]);

  // Tester States (Chat Engine)
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [chatSkillId, setChatSkillId] = useState('');
  const [userMsgInput, setUserMsgInput] = useState('');
  const [autoExecuteMocks, setAutoExecuteMocks] = useState(true);
  const [runningChat, setRunningChat] = useState(false);
  const [chatError, setChatError] = useState('');

  // Step-by-Step interception input states
  const [pendingToolCalls, setPendingToolCalls] = useState<any[] | null>(null);
  const [manualResponses, setManualResponses] = useState<{ [callId: string]: string }>({});

  // Accordion UI state for tool calls
  const [openTraceIndex, setOpenTraceIndex] = useState<number | null>(null);

  const models = [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'ollama/llama3', label: 'Ollama: Llama 3' },
    { value: 'lmstudio/local-model', label: 'LM Studio: Local Model' },
  ];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tData, sData, sessData] = await Promise.all([
        api.get('/api/tools'),
        api.get('/api/skills'),
        api.get('/api/sessions')
      ]);
      setTools(tData);
      setSkills(sData);
      setSessions(sessData);
      
      if (tData.length > 0) {
        selectTool(tData[0]);
      }
      if (sData.length > 0) {
        selectSkill(sData[0]);
        setChatSkillId(sData[0].id);
      }
      if (sessData.length > 0) {
        setActiveSession(sessData[0]);
      }
    } catch (e) {
      console.error('Error loading Agent workspace:', e);
    } finally {
      setLoading(false);
    }
  };

  // Tool Selection & Form Mapping
  const selectTool = (tool: Tool | null) => {
    setSelectedTool(tool);
    if (tool) {
      setToolName(tool.name);
      setToolDesc(tool.description);
      setToolMockResponse(tool.mockResponse);
      setToolExecutionMode(tool.executionMode || 'mock');
      setToolCode(tool.code || JS_TEMPLATE);
      
      const params: ToolParameter[] = [];
      if (tool.parameters && tool.parameters.properties) {
        for (const [name, prop] of Object.entries(tool.parameters.properties)) {
          params.push({
            name,
            type: (prop as any).type || 'string',
            description: (prop as any).description || '',
            required: tool.parameters.required?.includes(name) || false
          });
        }
      }
      setToolParams(params);
    } else {
      setToolName('');
      setToolDesc('');
      setToolMockResponse('{}');
      setToolExecutionMode('mock');
      setToolCode(JS_TEMPLATE);
      setToolParams([]);
    }
  };

  // Skill Selection & Form Mapping
  const selectSkill = (skill: Skill | null) => {
    setSelectedSkill(skill);
    if (skill) {
      setSkillName(skill.name);
      setSkillDesc(skill.description);
      setSkillSystemInstruction(skill.systemInstruction);
      setSkillSelectedTools(skill.tools || []);
    } else {
      setSkillName('');
      setSkillDesc('');
      setSkillSystemInstruction('');
      setSkillSelectedTools([]);
    }
  };

  const handleAddParameter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParamName.trim()) return;

    if (toolParams.some(p => p.name === newParamName.trim())) {
      alert('Parameter name must be unique.');
      return;
    }

    setToolParams([
      ...toolParams,
      {
        name: newParamName.trim(),
        type: newParamType,
        description: newParamDesc.trim(),
        required: newParamRequired
      }
    ]);

    setNewParamName('');
    setNewParamDesc('');
    setNewParamRequired(false);
  };

  const handleRemoveParameter = (name: string) => {
    setToolParams(toolParams.filter(p => p.name !== name));
  };

  const handleSaveTool = async () => {
    if (!toolName.trim()) {
      alert('Tool name is required.');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(toolName)) {
      alert('Tool name must contain only alphanumeric characters and underscores.');
      return;
    }

    if (toolExecutionMode === 'mock') {
      try {
        JSON.parse(toolMockResponse);
      } catch (e) {
        alert('Mock Response must be valid JSON.');
        return;
      }
    }

    const properties: { [key: string]: any } = {};
    const required: string[] = [];
    toolParams.forEach(p => {
      properties[p.name] = {
        type: p.type,
        description: p.description
      };
      if (p.required) {
        required.push(p.name);
      }
    });

    const payload = {
      name: toolName.trim(),
      description: toolDesc.trim(),
      parameters: {
        type: 'object',
        properties,
        required
      },
      mockResponse: toolMockResponse,
      executionMode: toolExecutionMode,
      code: toolCode
    };

    try {
      if (selectedTool) {
        await api.delete(`/api/tools/${selectedTool.id}`);
      }
      const saved = await api.post('/api/tools', payload);
      
      const refreshedTools = await api.get('/api/tools');
      setTools(refreshedTools);
      selectTool(refreshedTools.find((t: any) => t.name === saved.name) || null);
      alert('Tool saved successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to save tool.');
    }
  };

  const handleDeleteTool = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this tool?')) return;
    try {
      await api.delete(`/api/tools/${id}`);
      const refreshedTools = await api.get('/api/tools');
      setTools(refreshedTools);
      if (refreshedTools.length > 0) {
        selectTool(refreshedTools[0]);
      } else {
        selectTool(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveSkill = async () => {
    if (!skillName.trim()) {
      alert('Skill name is required.');
      return;
    }

    const payload = {
      name: skillName.trim(),
      description: skillDesc.trim(),
      systemInstruction: skillSystemInstruction.trim(),
      tools: skillSelectedTools
    };

    try {
      if (selectedSkill) {
        await api.delete(`/api/skills/${selectedSkill.id}`);
      }
      const saved = await api.post('/api/skills', payload);
      const refreshedSkills = await api.get('/api/skills');
      setSkills(refreshedSkills);
      selectSkill(refreshedSkills.find((s: any) => s.name === saved.name) || null);
      alert('Skill saved successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to save skill.');
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this skill?')) return;
    try {
      await api.delete(`/api/skills/${id}`);
      const refreshedSkills = await api.get('/api/skills');
      setSkills(refreshedSkills);
      if (refreshedSkills.length > 0) {
        selectSkill(refreshedSkills[0]);
      } else {
        selectSkill(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleToolForSkill = (toolId: string) => {
    if (skillSelectedTools.includes(toolId)) {
      setSkillSelectedTools(skillSelectedTools.filter(id => id !== toolId));
    } else {
      setSkillSelectedTools([...skillSelectedTools, toolId]);
    }
  };

  // --- Session History / Chat Methods ---

  const getDisplayTrace = (sess: ChatSession | null): any[] => {
    if (!sess) return [];
    if (sess.trace && sess.trace.length > 0) return sess.trace;
    
    const reconstructedTrace: any[] = [];
    const messages = sess.messages || [];
    
    for (const msg of messages) {
      if (msg.role === 'user') {
        if (msg.parts && msg.parts.length > 0 && msg.parts[0].functionResponse) {
          msg.parts.forEach((p: any) => {
            if (p.functionResponse) {
              const resObj = p.functionResponse.response;
              reconstructedTrace.push({
                role: 'tool',
                name: p.functionResponse.name,
                toolCallId: p.functionResponse.name,
                content: typeof resObj === 'object' ? JSON.stringify(resObj, null, 2) : String(resObj)
              });
            }
          });
        } else {
          const text = msg.content || (msg.parts && msg.parts.map((p: any) => p.text).filter(Boolean).join('\n')) || '';
          reconstructedTrace.push({
            role: 'user',
            content: text
          });
        }
      } else if (msg.role === 'assistant' || msg.role === 'model') {
        let toolCalls = null;
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          toolCalls = msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name || tc.name,
            args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || tc.args
          }));
        } else if (msg.parts && msg.parts.length > 0) {
          const fnCallParts = msg.parts.filter((p: any) => p.functionCall);
          if (fnCallParts.length > 0) {
            toolCalls = fnCallParts.map((fc: any, idx: number) => ({
              id: 'gen_call_' + idx,
              name: fc.functionCall.name,
              args: fc.functionCall.args
            }));
          }
        }
        
        if (toolCalls && toolCalls.length > 0) {
          reconstructedTrace.push({
            role: 'model',
            type: 'tool_call',
            toolCalls
          });
        }
        
        const text = msg.content || (msg.parts && msg.parts.map((p: any) => p.text).filter(Boolean).join('\n')) || '';
        if (text) {
          reconstructedTrace.push({
            role: 'model',
            type: 'text',
            content: text
          });
        }
      } else if (msg.role === 'tool') {
        reconstructedTrace.push({
          role: 'tool',
          name: msg.name,
          toolCallId: msg.tool_call_id,
          content: msg.content
        });
      }
    }
    return reconstructedTrace;
  };

  const handleCreateSession = async () => {
    const activeSkill = skills.find(s => s.id === chatSkillId);
    if (!activeSkill) return;

    try {
      const newSess = await api.post('/api/sessions', {
        skillId: chatSkillId,
        name: `Chat with ${activeSkill.name}`,
        messages: [],
        trace: [],
        metrics: null
      });

      setSessions([newSess, ...sessions]);
      setActiveSession(newSess);
      setPendingToolCalls(null);
      setChatError('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessId: string) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this chat session?')) return;

    try {
      await api.delete(`/api/sessions/${sessId}`);
      const refreshed = sessions.filter(s => s.id !== sessId);
      setSessions(refreshed);
      
      if (activeSession?.id === sessId) {
        setActiveSession(refreshed.length > 0 ? refreshed[0] : null);
        setPendingToolCalls(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendChatMessage = async () => {
    if (!userMsgInput.trim() || !activeSession) return;

    const activeSkill = skills.find(s => s.id === activeSession.skillId);
    if (!activeSkill) return;

    const userMsgText = userMsgInput.trim();
    setUserMsgInput('');
    setRunningChat(true);
    setChatError('');
    setPendingToolCalls(null);

    // Get active tools (combining user custom tools + system search/scraper tools)
    let activeTools: any[] = tools.filter(t => activeSkill.tools?.includes(t.id));
    
    // Add system tools metadata if attached to skill
    if (activeSkill.tools?.includes('system_web_search')) {
      activeTools.push(SYSTEM_TOOLS[0]);
    }
    if (activeSkill.tools?.includes('system_web_scraper')) {
      activeTools.push(SYSTEM_TOOLS[1]);
    }

    // Append user message to thread
    const userMessage: ChatMessage = {
      role: 'user',
      content: userMsgText
    };

    const nextHistory = [...(activeSession.messages || []), userMessage];
    const newTraceSteps = [...(activeSession.trace || []), { role: 'user', content: userMsgText }];

    // Temporarily update local state for fast UI rendering
    const tempSession = {
      ...activeSession,
      messages: nextHistory,
      trace: newTraceSteps
    };
    setActiveSession(tempSession);

    try {
      const res = await api.post('/api/agent/run', {
        model: selectedModel,
        systemInstruction: activeSkill.systemInstruction,
        history: nextHistory,
        tools: activeTools,
        autoExecuteMocks
      });

      // Update full trace and conversation messages
      const finalTrace = [...newTraceSteps, ...(res.trace || [])];
      
      const sessionMetrics = res.metrics ? {
        durationMs: (activeSession.metrics?.durationMs || 0) + res.metrics.durationMs,
        tokenUsage: {
          inputTokens: (activeSession.metrics?.tokenUsage?.inputTokens || 0) + res.metrics.tokenUsage.inputTokens,
          outputTokens: (activeSession.metrics?.tokenUsage?.outputTokens || 0) + res.metrics.tokenUsage.outputTokens,
          totalTokens: (activeSession.metrics?.tokenUsage?.totalTokens || 0) + res.metrics.tokenUsage.totalTokens
        },
        costEstimate: (activeSession.metrics?.costEstimate || 0) + res.metrics.costEstimate
      } : activeSession.metrics;

      const updatedSess = await api.post('/api/sessions', {
        id: activeSession.id,
        skillId: activeSession.skillId,
        name: activeSession.name,
        messages: res.history || nextHistory,
        trace: finalTrace,
        metrics: sessionMetrics
      });

      // Sync views
      setSessions(sessions.map(s => s.id === updatedSess.id ? updatedSess : s));
      setActiveSession(updatedSess);

      // Handle step-by-step pauses
      const lastStep = res.trace?.[res.trace.length - 1];
      if (lastStep?.type === 'tool_call' && !autoExecuteMocks) {
        setPendingToolCalls(lastStep.toolCalls);
        const initialResponses: { [callId: string]: string } = {};
        lastStep.toolCalls.forEach((tc: any) => {
          const match = activeTools.find(t => t.name === tc.name);
          initialResponses[tc.id] = match?.mockResponse || '{}';
        });
        setManualResponses(initialResponses);
      }
    } catch (e: any) {
      setChatError(e.message || 'Failed to send message.');
    } finally {
      setRunningChat(false);
    }
  };

  const handleInjectManualChatResponse = async () => {
    if (!pendingToolCalls || !activeSession) return;

    const activeSkill = skills.find(s => s.id === activeSession.skillId);
    if (!activeSkill) return;

    setRunningChat(true);
    setChatError('');

    let activeTools: any[] = tools.filter(t => activeSkill.tools?.includes(t.id));
    if (activeSkill.tools?.includes('system_web_search')) {
      activeTools.push(SYSTEM_TOOLS[0]);
    }
    if (activeSkill.tools?.includes('system_web_scraper')) {
      activeTools.push(SYSTEM_TOOLS[1]);
    }

    const nextHistory = [...(activeSession.messages || [])];
    const newTraceSteps = [...(activeSession.trace || [])];

    // Format tool result based on active model rules
    if (selectedModel.startsWith('gemini')) {
      const parts = pendingToolCalls.map(tc => {
        const mockValue = manualResponses[tc.id] || '{}';
        
        newTraceSteps.push({
          role: 'tool',
          name: tc.name,
          toolCallId: tc.id,
          content: mockValue
        });

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(mockValue);
        } catch (e) {
          parsedResponse = { response: mockValue };
        }

        return {
          functionResponse: {
            name: tc.name,
            response: { name: tc.name, content: parsedResponse }
          }
        };
      });
      nextHistory.push({ role: 'user', parts });
    } else if (selectedModel.startsWith('claude')) {
      const content = pendingToolCalls.map(tc => {
        const mockValue = manualResponses[tc.id] || '{}';
        
        newTraceSteps.push({
          role: 'tool',
          name: tc.name,
          toolCallId: tc.id,
          content: mockValue
        });

        return {
          type: 'tool_result',
          tool_use_id: tc.id,
          content: mockValue
        };
      });
      nextHistory.push({ role: 'user', content });
    } else {
      for (const tc of pendingToolCalls) {
        const mockValue = manualResponses[tc.id] || '{}';

        newTraceSteps.push({
          role: 'tool',
          name: tc.name,
          toolCallId: tc.id,
          content: mockValue
        });

        nextHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: mockValue
        });
      }
    }

    setPendingToolCalls(null);

    try {
      const res = await api.post('/api/agent/run', {
        model: selectedModel,
        systemInstruction: activeSkill.systemInstruction,
        history: nextHistory,
        tools: activeTools,
        autoExecuteMocks: false
      });

      const finalTrace = [...newTraceSteps, ...(res.trace || [])];
      
      const sessionMetrics = res.metrics ? {
        durationMs: (activeSession.metrics?.durationMs || 0) + res.metrics.durationMs,
        tokenUsage: {
          inputTokens: (activeSession.metrics?.tokenUsage?.inputTokens || 0) + res.metrics.tokenUsage.inputTokens,
          outputTokens: (activeSession.metrics?.tokenUsage?.outputTokens || 0) + res.metrics.tokenUsage.outputTokens,
          totalTokens: (activeSession.metrics?.tokenUsage?.totalTokens || 0) + res.metrics.tokenUsage.totalTokens
        },
        costEstimate: (activeSession.metrics?.costEstimate || 0) + res.metrics.costEstimate
      } : activeSession.metrics;

      const updatedSess = await api.post('/api/sessions', {
        id: activeSession.id,
        skillId: activeSession.skillId,
        name: activeSession.name,
        messages: res.history || nextHistory,
        trace: finalTrace,
        metrics: sessionMetrics
      });

      setSessions(sessions.map(s => s.id === updatedSess.id ? updatedSess : s));
      setActiveSession(updatedSess);

      const lastStep = res.trace?.[res.trace.length - 1];
      if (lastStep?.type === 'tool_call') {
        setPendingToolCalls(lastStep.toolCalls);
        const initialResponses: { [callId: string]: string } = {};
        lastStep.toolCalls.forEach((tc: any) => {
          const match = activeTools.find(t => t.name === tc.name);
          initialResponses[tc.id] = match?.mockResponse || '{}';
        });
        setManualResponses(initialResponses);
      }
    } catch (e: any) {
      setChatError(e.message || 'Failed to execute manual step.');
    } finally {
      setRunningChat(false);
    }
  };

  // Interactive Rewinding helper
  const handleRewindSession = async (traceIndex: number) => {
    if (!activeSession) return;

    if (!window.confirm('Rewind conversation to this step? All subsequent exchanges will be deleted.')) return;

    // Truncate the trace array
    const currentTrace = activeSession.trace && activeSession.trace.length > 0
      ? activeSession.trace
      : getDisplayTrace(activeSession);
    const nextTrace = currentTrace.slice(0, traceIndex + 1);

    // Reconstruct conversation history array from remaining trace
    const nextHistory: ChatMessage[] = [];
    
    // We iterate through the remaining trace and build Gemini/Claude/OpenAI compatible histories
    let activeGeminiParts: any[] = [];
    let activeClaudeContent: any[] = [];

    for (let i = 0; i < nextTrace.length; i++) {
      const step = nextTrace[i];
      
      if (step.role === 'user') {
        if (selectedModel.startsWith('gemini')) {
          nextHistory.push({ role: 'user', parts: [{ text: step.content }] });
        } else {
          nextHistory.push({ role: 'user', content: step.content });
        }
      } else if (step.role === 'model') {
        if (step.type === 'text') {
          if (selectedModel.startsWith('gemini')) {
            nextHistory.push({ role: 'model', parts: [{ text: step.content }] });
          } else {
            nextHistory.push({ role: 'assistant', content: step.content });
          }
        } else if (step.type === 'tool_call') {
          if (selectedModel.startsWith('gemini')) {
            const parts = step.toolCalls.map((tc: any) => ({
              functionCall: { name: tc.name, args: tc.args }
            }));
            nextHistory.push({ role: 'model', parts });
          } else if (selectedModel.startsWith('claude')) {
            const content = step.toolCalls.map((tc: any) => ({
              type: 'tool_use', id: tc.id, name: tc.name, input: tc.args
            }));
            nextHistory.push({ role: 'assistant', content });
          } else {
            const tool_calls = step.toolCalls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }));
            nextHistory.push({ role: 'assistant', tool_calls });
          }
        }
      } else if (step.role === 'tool') {
        if (selectedModel.startsWith('gemini')) {
          let parsed;
          try { parsed = JSON.parse(step.content); } catch(e) { parsed = { response: step.content }; }
          
          activeGeminiParts.push({
            functionResponse: {
              name: step.name,
              response: { name: step.name, content: parsed }
            }
          });
          // If next step is not a tool, or we are at the end, commit
          const nextStep = nextTrace[i + 1];
          if (!nextStep || nextStep.role !== 'tool') {
            nextHistory.push({ role: 'user', parts: activeGeminiParts });
            activeGeminiParts = [];
          }
        } else if (selectedModel.startsWith('claude')) {
          activeClaudeContent.push({
            type: 'tool_result',
            tool_use_id: step.toolCallId,
            content: step.content
          });
          const nextStep = nextTrace[i + 1];
          if (!nextStep || nextStep.role !== 'tool') {
            nextHistory.push({ role: 'user', content: activeClaudeContent });
            activeClaudeContent = [];
          }
        } else {
          // OpenAI
          nextHistory.push({
            role: 'tool',
            tool_call_id: step.toolCallId,
            name: step.name,
            content: step.content
          });
        }
      }
    }

    try {
      const updatedSess = await api.post('/api/sessions', {
        id: activeSession.id,
        skillId: activeSession.skillId,
        name: activeSession.name,
        messages: nextHistory,
        trace: nextTrace,
        metrics: activeSession.metrics // keep accumulated cost
      });

      setSessions(sessions.map(s => s.id === updatedSess.id ? updatedSess : s));
      setActiveSession(updatedSess);
      setPendingToolCalls(null);
      setChatError('');
    } catch (e) {
      console.error('Rewind failed:', e);
    }
  };

  if (loading) {
    return (
      <div className="agent-loading">
        <div className="loading-spinner"></div>
        <p>Loading Agentic Environment Workspace...</p>
      </div>
    );
  }

  return (
    <div className="agent-workspace-container fade-in">
      <div className="agent-workspace-header">
        <div>
          <h1>Tools & Skills Workspace</h1>
          <p>Design visual OpenAPI schemas for LLM function calling and compile system-prompt agent skills.</p>
        </div>
        
        <div className="tab-control-group glass-panel">
          <button 
            className={`tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            <Wrench size={14} /> Tools Builder
          </button>
          <button 
            className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveTab('skills')}
          >
            <Cpu size={14} /> Agent Skills
          </button>
          <button 
            className={`tab-btn ${activeTab === 'tester' ? 'active' : ''}`}
            onClick={() => setActiveTab('tester')}
          >
            <Play size={14} /> Interactive Tester
          </button>
        </div>
      </div>

      {/* Tab Panel: Tools Builder */}
      {activeTab === 'tools' && (
        <div className="agent-split-layout">
          <div className="agent-sidebar glass-panel">
            <div className="sidebar-list-header">
              <h3>Registered Tools ({tools.length})</h3>
              <button className="icon-add-btn" onClick={() => selectTool(null)}>
                <PlusCircle size={16} /> New
              </button>
            </div>
            
            <div className="list-wrapper">
              {tools.map(t => (
                <div 
                  key={t.id} 
                  className={`list-item ${selectedTool?.id === t.id ? 'active' : ''}`}
                  onClick={() => selectTool(t)}
                >
                  <div className="item-title">{t.name}</div>
                  <div className="item-sub">{t.description || 'No description provided'}</div>
                </div>
              ))}
              {tools.length === 0 && (
                <div className="list-empty-msg">No tools registered. Create a new one above.</div>
              )}
            </div>
          </div>

          <div className="agent-details-editor glass-panel">
            <div className="editor-header">
              <h3>{selectedTool ? `Edit Tool: ${selectedTool.name}` : 'Register New Tool'}</h3>
              {selectedTool && (
                <button className="btn-delete" onClick={() => handleDeleteTool(selectedTool.id)}>
                  <Trash2 size={14} /> Delete Tool
                </button>
              )}
            </div>

            <div className="editor-fields">
              <div className="form-group">
                <label>Tool/Function Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. search_database (lowercase, underscores only)"
                  value={toolName} 
                  onChange={(e) => setToolName(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label>System Description (Very important for LLM routing)</label>
                <textarea 
                  rows={2}
                  placeholder="e.g. Look up user details by customer account ID. Returns status and plan info."
                  value={toolDesc} 
                  onChange={(e) => setToolDesc(e.target.value)} 
                />
              </div>

              {/* Param Schema Builder */}
              <div className="param-builder-section">
                <h4>Parameters JSON Schema Builder</h4>
                
                <form onSubmit={handleAddParameter} className="add-param-row">
                  <input 
                    type="text" 
                    placeholder="Name" 
                    value={newParamName} 
                    onChange={(e) => setNewParamName(e.target.value)}
                    required
                  />
                  <select 
                    value={newParamType} 
                    onChange={(e) => setNewParamType(e.target.value as any)}
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="array">Array</option>
                    <option value="object">Object</option>
                  </select>
                  <input 
                    type="text" 
                    placeholder="Parameter Description" 
                    value={newParamDesc} 
                    onChange={(e) => setNewParamDesc(e.target.value)}
                  />
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={newParamRequired} 
                      onChange={(e) => setNewParamRequired(e.target.checked)} 
                    />
                    <span>Req</span>
                  </label>
                  <button type="submit" className="btn-add-param">Add</button>
                </form>

                <div className="params-list-wrapper">
                  {toolParams.map(p => (
                    <div key={p.name} className="param-item-row">
                      <span className="param-badge-name">{p.name}</span>
                      <span className="param-badge-type">{p.type}</span>
                      <span className="param-badge-desc">{p.description}</span>
                      {p.required && <span className="param-badge-req">required</span>}
                      <button className="btn-remove-param" onClick={() => handleRemoveParameter(p.name)}>×</button>
                    </div>
                  ))}
                  {toolParams.length === 0 && (
                    <div className="params-empty-msg">No parameters defined. Add parameter variables above.</div>
                  )}
                </div>
              </div>

              {/* Execution Mode Selector */}
              <div className="form-group">
                <label>Tool Execution Mode</label>
                <select 
                  value={toolExecutionMode}
                  onChange={(e) => setToolExecutionMode(e.target.value as any)}
                  style={{ background: 'rgba(0, 0, 0, 0.15)', color: 'white' }}
                >
                  <option value="mock">Static Mock Response</option>
                  <option value="javascript">Live JavaScript Sandbox Script</option>
                </select>
              </div>

              {toolExecutionMode === 'mock' ? (
                <div className="form-group animate-slide">
                  <label>Mock Response JSON (Returned during execution simulations)</label>
                  <textarea 
                    rows={4}
                    className="code-textarea"
                    placeholder='e.g. {"status": "success", "results": [1, 2, 3]}'
                    value={toolMockResponse} 
                    onChange={(e) => setToolMockResponse(e.target.value)} 
                  />
                </div>
              ) : (
                <div className="form-group animate-slide">
                  <label>JavaScript Live Script (Async Sandbox Execution)</label>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Provide an asynchronous Javascript script block that returns an Object or String.
                  </span>
                  <textarea 
                    rows={12}
                    className="code-textarea"
                    style={{ fontStyle: 'normal' }}
                    value={toolCode} 
                    onChange={(e) => setToolCode(e.target.value)} 
                  />
                </div>
              )}

              <button className="btn btn-primary" onClick={handleSaveTool}>
                Save Tool Definition
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Panel: Agent Skills */}
      {activeTab === 'skills' && (
        <div className="agent-split-layout">
          <div className="agent-sidebar glass-panel">
            <div className="sidebar-list-header">
              <h3>Agent Skills ({skills.length})</h3>
              <button className="icon-add-btn" onClick={() => selectSkill(null)}>
                <PlusCircle size={16} /> New
              </button>
            </div>
            
            <div className="list-wrapper">
              {skills.map(s => (
                <div 
                  key={s.id} 
                  className={`list-item ${selectedSkill?.id === s.id ? 'active' : ''}`}
                  onClick={() => selectSkill(s)}
                >
                  <div className="item-title">{s.name}</div>
                  <div className="item-sub">{s.description || 'No description provided'}</div>
                </div>
              ))}
              {skills.length === 0 && (
                <div className="list-empty-msg">No skills defined. Create a new one above.</div>
              )}
            </div>
          </div>

          <div className="agent-details-editor glass-panel">
            <div className="editor-header">
              <h3>{selectedSkill ? `Edit Skill: ${selectedSkill.name}` : 'Create New Skill'}</h3>
              {selectedSkill && (
                <button className="btn-delete" onClick={() => handleDeleteSkill(selectedSkill.id)}>
                  <Trash2 size={14} /> Delete Skill
                </button>
              )}
            </div>

            <div className="editor-fields">
              <div className="form-group">
                <label>Skill / Agent Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Customer Return Handler"
                  value={skillName} 
                  onChange={(e) => setSkillName(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea 
                  rows={2}
                  placeholder="e.g. Specializes in tracking orders and handling refunds."
                  value={skillDesc} 
                  onChange={(e) => setSkillDesc(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label>System Instruction (Agent Persona and Workflow Guidelines)</label>
                <textarea 
                  rows={6}
                  placeholder="You are a support agent specializing in refunds. When user requests refund, first call look_up_order tool. Only issue refund if order status is Delivered."
                  value={skillSystemInstruction} 
                  onChange={(e) => setSkillSystemInstruction(e.target.value)} 
                />
              </div>

              <div className="tools-selector-section">
                <h4>Attach Execution Tools</h4>
                <div className="tools-selection-grid">
                  {/* System built-in tools first */}
                  <label className="tool-checkbox-item system-tool-checkbox">
                    <input 
                      type="checkbox"
                      checked={skillSelectedTools.includes('system_web_search')}
                      onChange={() => handleToggleToolForSkill('system_web_search')}
                    />
                    <div className="checkbox-info">
                      <span className="chk-tool-name" style={{ color: 'var(--accent-primary)' }}>system_web_search (System)</span>
                      <span className="chk-tool-desc">Query DuckDuckGo for live real-time web search summaries.</span>
                    </div>
                  </label>
                  
                  <label className="tool-checkbox-item system-tool-checkbox">
                    <input 
                      type="checkbox"
                      checked={skillSelectedTools.includes('system_web_scraper')}
                      onChange={() => handleToggleToolForSkill('system_web_scraper')}
                    />
                    <div className="checkbox-info">
                      <span className="chk-tool-name" style={{ color: 'var(--accent-primary)' }}>system_web_scraper (System)</span>
                      <span className="chk-tool-desc">Fetch and summarize visible visible text from a website URL.</span>
                    </div>
                  </label>

                  {/* Custom user registered tools */}
                  {tools.map(t => (
                    <label key={t.id} className="tool-checkbox-item">
                      <input 
                        type="checkbox"
                        checked={skillSelectedTools.includes(t.id)}
                        onChange={() => handleToggleToolForSkill(t.id)}
                      />
                      <div className="checkbox-info">
                        <span className="chk-tool-name">{t.name}</span>
                        <span className="chk-tool-desc">{t.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleSaveSkill}>
                Save Skill Definition
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Panel: Tester Chat Room */}
      {activeTab === 'tester' && (
        <div className="tester-layout glass-panel">
          {/* Chat Sessions left bar */}
          <div className="tester-config-side">
            <div className="sessions-list-header">
              <h4>Chat Sessions</h4>
              <button 
                className="btn btn-secondary btn-new-session" 
                onClick={handleCreateSession}
                disabled={skills.length === 0}
              >
                <Plus size={14} /> New Chat
              </button>
            </div>

            <div className="tester-settings-group" style={{ marginBottom: '12px' }}>
              <div className="setting-item">
                <label>Target Agent Persona (Skill)</label>
                <select value={chatSkillId} onChange={(e) => setChatSkillId(e.target.value)}>
                  {skills.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {skills.length === 0 && <option value="">No skills defined</option>}
                </select>
              </div>

              <div className="setting-item">
                <label>Select Model</label>
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  {models.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="setting-item-checkbox">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={autoExecuteMocks} 
                    onChange={(e) => setAutoExecuteMocks(e.target.checked)} 
                  />
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600 }}>Auto-Execute Mocks</span>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Evaluate live JS/system search calls automatically.</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Chat Sessions list view */}
            <div className="sessions-history-list">
              {sessions.map(sess => {
                const associatedSkill = skills.find(s => s.id === sess.skillId);
                return (
                  <div 
                    key={sess.id} 
                    className={`session-card ${activeSession?.id === sess.id ? 'active' : ''}`}
                    onClick={() => { setActiveSession(sess); setPendingToolCalls(null); }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="sess-title">{sess.name}</div>
                      <div className="sess-skill">{associatedSkill?.name || 'Unknown Skill'}</div>
                    </div>
                    <button 
                      className="sess-delete-btn"
                      onClick={(e) => handleDeleteSession(e, sess.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {sessions.length === 0 && (
                <div className="sess-empty-msg">No active sessions. Click "New Chat" above to start.</div>
              )}
            </div>

            {/* Session Stats */}
            {activeSession && activeSession.metrics && (
              <div className="tester-metrics-card" style={{ marginTop: 'auto' }}>
                <h4>Session Cumulative Spent</h4>
                <div className="metrics-grid">
                  <div className="metric-cell">
                    <span className="cell-title"><Clock size={11} /> Total Latency</span>
                    <span className="cell-value">{activeSession.metrics.durationMs}ms</span>
                  </div>
                  <div className="metric-cell">
                    <span className="cell-title"><TrendingUp size={11} /> Total Tokens</span>
                    <span className="cell-value">{activeSession.metrics.tokenUsage?.totalTokens || 0}</span>
                  </div>
                  <div className="metric-cell" style={{ gridColumn: 'span 2', border: '1px solid rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.03)' }}>
                    <span className="cell-title" style={{ color: 'var(--success)' }}><Sparkles size={11} /> Accumulated Cost</span>
                    <span className="cell-value" style={{ color: 'var(--success)', fontSize: '13px' }}>${activeSession.metrics.costEstimate?.toFixed(5) || '0.00000'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Console: Chat thread */}
          <div className="tester-console-main">
            {activeSession ? (
              <>
                <div className="console-display-area" style={{ padding: '24px 32px' }}>
                  {chatError && (
                    <div className="console-error-bubble">
                      <AlertCircle size={16} />
                      <span>{chatError}</span>
                    </div>
                  )}

                  {/* Render inline trace conversation blocks */}
                  {getDisplayTrace(activeSession).map((step, index) => {
                    if (step.role === 'user') {
                      return (
                        <div key={index} className="chat-row user-row">
                          <div className="chat-bubble user-bubble">
                            {step.content}
                          </div>
                        </div>
                      );
                    } else if (step.role === 'model') {
                      if (step.type === 'text') {
                        return (
                          <div key={index} className="chat-row assistant-row">
                            <div className="chat-bubble assistant-bubble">
                              <MarkdownRenderer content={step.content} />
                              <button 
                                className="rewind-btn" 
                                title="Rewind convo to this step" 
                                onClick={() => handleRewindSession(index)}
                              >
                                <RotateCcw size={11} /> Rewind
                              </button>
                            </div>
                          </div>
                        );
                      } else if (step.type === 'tool_call') {
                        return (
                          <div key={index} className="chat-row trace-log-row">
                            <div 
                              className={`trace-collapsible-header ${openTraceIndex === index ? 'open' : ''}`}
                              onClick={() => setOpenTraceIndex(openTraceIndex === index ? null : index)}
                            >
                              <Cpu size={12} style={{ color: 'var(--accent-primary)' }} />
                              <span>Model requested tool execution ({step.toolCalls?.length} calls)</span>
                              <span className="toggle-indicator">{openTraceIndex === index ? '▲' : '▼'}</span>
                            </div>
                            
                            {openTraceIndex === index && (
                              <div className="trace-collapsible-body">
                                {step.toolCalls.map((tc: any) => (
                                  <div key={tc.id} className="tc-detail-block">
                                    <div className="tc-detail-title">Function: <code>{tc.name}</code></div>
                                    <pre className="tc-detail-args">{JSON.stringify(tc.args, null, 2)}</pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                    } else if (step.role === 'tool') {
                      return (
                        <div key={index} className="chat-row trace-log-row">
                          <div 
                            className={`trace-collapsible-header tool-header ${openTraceIndex === index ? 'open' : ''}`}
                            onClick={() => setOpenTraceIndex(openTraceIndex === index ? null : index)}
                          >
                            <Wrench size={12} style={{ color: 'var(--success)' }} />
                            <span>Tool returned response: <b>{step.name}</b></span>
                            <span className="toggle-indicator">{openTraceIndex === index ? '▲' : '▼'}</span>
                          </div>
                          
                          {openTraceIndex === index && (
                            <div className="trace-collapsible-body">
                              <pre className="tc-detail-response">{step.content}</pre>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Manual interception view cards */}
                  {pendingToolCalls && (
                    <div className="manual-intercept-card animate-slide" style={{ margin: '16px 0' }}>
                      <div className="intercept-header">
                        <AlertCircle size={14} className="yellow" />
                        <span>Tool Execution Paused (Auto-Execute Off)</span>
                      </div>
                      <p>Modify response schemas or execute scripts manually before sending back to model:</p>
                      
                      {pendingToolCalls.map(tc => (
                        <div key={tc.id} className="manual-inject-field">
                          <div className="inject-meta">
                            <span>Function: <b>{tc.name}</b></span>
                            <span>Call ID: <code>{tc.id}</code></span>
                          </div>
                          <textarea
                            rows={3}
                            value={manualResponses[tc.id] || ''}
                            onChange={(e) => setManualResponses({
                              ...manualResponses,
                              [tc.id]: e.target.value
                            })}
                          />
                        </div>
                      ))}

                      <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end', marginTop: '6px' }}>
                        <button 
                          className="btn-primary-mini" 
                          onClick={handleInjectManualChatResponse}
                          disabled={runningChat}
                        >
                          Inject & Continue Loop
                        </button>
                      </div>
                    </div>
                  )}

                  {runningChat && (
                    <div className="console-loading-step">
                      <div className="loading-spinner"></div>
                      <span>Model is reasoning & executing steps...</span>
                    </div>
                  )}
                </div>

                {/* Chat Input Bar */}
                <div className="console-input-row">
                  <input 
                    type="text" 
                    placeholder="Enter customer input message or instruction..."
                    value={userMsgInput}
                    onChange={(e) => setUserMsgInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !runningChat && handleSendChatMessage()}
                    disabled={runningChat || !!pendingToolCalls}
                  />
                  <button 
                    className="btn btn-primary btn-run-test" 
                    onClick={handleSendChatMessage}
                    disabled={runningChat || !userMsgInput.trim() || !!pendingToolCalls}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </>
            ) : (
              <div className="console-empty">
                <HelpCircle size={32} className="empty-icon" />
                <h4>No Chat Session Selected</h4>
                <p>Choose an existing session on the left or click "New Chat" to configure a live conversation.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default AgentWorkspace;
