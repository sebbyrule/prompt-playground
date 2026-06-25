import React, { useState, useEffect, useRef } from 'react';
import { 
  SendHorizontal, 
  Bot, 
  Trash2, 
  Check, 
  Copy, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  Mic,
  MicOff,
  HelpCircle,
  FileDown,
  X,
  ArrowRight,
  Plus,
  MessageSquare
} from 'lucide-react';
import api from '../utils/api';
import { MarkdownRenderer } from './MarkdownRenderer';
import './PromptCopilot.css';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  trace?: any[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  apiHistory: any[];
  model: string;
  createdAt: number;
}

export const PromptCopilot: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('copilot_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse copilot_sessions:', e);
      }
    }

    // Try migration from legacy single session keys
    const legacyMsgs = localStorage.getItem('copilot_messages');
    const legacyHist = localStorage.getItem('copilot_api_history');
    
    if (legacyMsgs) {
      try {
        const parsedMsgs = JSON.parse(legacyMsgs);
        const parsedHist = legacyHist ? JSON.parse(legacyHist) : [];
        const migratedSession: ChatSession = {
          id: 'session_migrated_' + Date.now(),
          title: 'Migrated Chat',
          messages: parsedMsgs,
          apiHistory: parsedHist,
          model: 'gemini-1.5-flash',
          createdAt: Date.now()
        };
        // Clean up legacy keys
        localStorage.removeItem('copilot_messages');
        localStorage.removeItem('copilot_api_history');
        
        return [migratedSession];
      } catch (e) {
        console.error('Failed to migrate legacy copilot messages:', e);
      }
    }

    // Default welcome session
    return [
      {
        id: 'session_default',
        title: 'Welcome Chat',
        messages: [
          {
            id: 'welcome',
            sender: 'assistant',
            content: 'Hi! I am your PromptForge Copilot. I can help you manage your prompt templates, projects, versions, branches, and custom agent tools.\n\nTry asking me:\n* "Show me all my projects"\n* "Create a new project named ReviewBot"\n* "Create a weather query tool script"\n* "Load the prompt Bug Finder and show me its details"\n* "Help me optimize my review template to be more creative"'
          }
        ],
        apiHistory: [],
        model: 'gemini-1.5-flash',
        createdAt: Date.now()
      }
    ];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    const savedId = localStorage.getItem('copilot_current_session_id');
    if (savedId) {
      return savedId;
    }
    const saved = localStorage.getItem('copilot_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0].id;
        }
      } catch {}
    }
    return 'session_default';
  });

  // Get active session details for state initialization
  const initialSession = sessions.find(s => s.id === currentSessionId) || sessions[0] || {
    messages: [
      {
        id: 'welcome',
        sender: 'assistant',
        content: 'Hi! I am your PromptForge Copilot. I can help you manage your prompt templates, projects, versions, branches, and custom agent tools.\n\nTry asking me:\n* "Show me all my projects"\n* "Create a new project named ReviewBot"\n* "Create a weather query tool script"\n* "Load the prompt Bug Finder and show me its details"\n* "Help me optimize my review template to be more creative"'
      }
    ],
    apiHistory: [],
    model: 'gemini-1.5-flash'
  };

  const [messages, setMessages] = useState<ChatMessage[]>(initialSession.messages);
  const [apiHistory, setApiHistory] = useState<any[]>(initialSession.apiHistory);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(initialSession.model);
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);
  const [jsonCopied, setJsonCopied] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [localModels, setLocalModels] = useState<{ value: string; label: string }[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [toolsList, setToolsList] = useState<any[]>([]);

  // Suggestion Mode
  const [suggestionMode, setSuggestionMode] = useState<'slash' | 'mention' | null>(null);
  const [filteredSuggestions, setFilteredSuggestions] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerIndex, setTriggerIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Speech Recognition State
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Apply to Editor Overlay State
  const [applyOverlayCode, setApplyOverlayCode] = useState<string | null>(null);

  useEffect(() => {
    const loadAutocompleteData = async () => {
      try {
        const [projs, t] = await Promise.all([
          api.get('/api/projects'),
          api.get('/api/tools')
        ]);
        setProjectsList(projs);
        setToolsList(t);
      } catch (err) {
        console.error('Failed to load autocomplete data:', err);
      }
    };
    loadAutocompleteData();
  }, []);

  // Load session data when currentSessionId changes
  useEffect(() => {
    const session = sessions.find(s => s.id === currentSessionId);
    if (session) {
      setMessages(session.messages);
      setApiHistory(session.apiHistory);
      setSelectedModel(session.model);
    }
  }, [currentSessionId]);

  // Sync current active session changes back to the sessions array
  useEffect(() => {
    setSessions(prev => {
      const target = prev.find(s => s.id === currentSessionId);
      if (!target) return prev;
      if (
        target.messages === messages &&
        target.apiHistory === apiHistory &&
        target.model === selectedModel
      ) {
        return prev;
      }
      return prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages,
            apiHistory,
            model: selectedModel
          };
        }
        return s;
      });
    });
  }, [messages, apiHistory, selectedModel, currentSessionId]);

  // Persist sessions and current ID to localStorage
  useEffect(() => {
    localStorage.setItem('copilot_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('copilot_current_session_id', currentSessionId);
  }, [currentSessionId]);


  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLocalModels = async () => {
      try {
        const res = await api.get('/api/local-models');
        if (res.models && Array.isArray(res.models)) {
          setLocalModels(res.models);
        }
      } catch (err) {
        console.error('Failed to load local models:', err);
      }
    };
    fetchLocalModels();
  }, []);

  const baseModels = [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' }
  ];

  const models = localModels.length > 0 
    ? [...baseModels, ...localModels]
    : [
        ...baseModels,
        { value: 'ollama/llama3', label: 'Ollama: Llama 3' },
        { value: 'ollama/mistral', label: 'Ollama: Mistral' },
        { value: 'ollama/phi3', label: 'Ollama: Phi 3' },
        { value: 'lmstudio/local-model', label: 'LM Studio: Local Model' }
      ];

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || loading) return;

    // Check for slash commands
    if (userMessage.startsWith('/')) {
      handleSlashCommand(userMessage);
      setInput('');
      return;
    }

    // Auto-title the session if it is a new/welcome chat
    const active = sessions.find(s => s.id === currentSessionId);
    if (active && (active.title === 'New Chat' || active.title === 'Welcome Chat')) {
      const newTitle = userMessage.length > 25 ? userMessage.slice(0, 25) + '...' : userMessage;
      setSessions(prev => 
        prev.map(s => {
          if (s.id === currentSessionId) {
            return { ...s, title: newTitle };
          }
          return s;
        })
      );
    }

    setInput('');
    setErrorText('');
    setLoading(true);

    const userMsgId = 'msg_' + Date.now();
    const newMessages: ChatMessage[] = [
      ...messages,
      { id: userMsgId, sender: 'user', content: userMessage }
    ];
    setMessages(newMessages);

    // Build apiHistory
    let nextApiHistory = [...apiHistory];
    if (nextApiHistory.length === 0) {
      if (selectedModel.startsWith('gemini')) {
        nextApiHistory.push({ role: 'user', parts: [{ text: userMessage }] });
      } else {
        nextApiHistory.push({ role: 'user', content: userMessage });
      }
    } else {
      if (selectedModel.startsWith('gemini')) {
        nextApiHistory.push({ role: 'user', parts: [{ text: userMessage }] });
      } else {
        nextApiHistory.push({ role: 'user', content: userMessage });
      }
    }

    try {
      const res = await api.post('/api/copilot/chat', {
        model: selectedModel,
        history: nextApiHistory,
        message: userMessage
      });

      // Save apiHistory returned by backend (which now has tool calls and results)
      setApiHistory(res.history || []);

      // Append assistant message
      setMessages(prev => [
        ...prev,
        {
          id: 'assistant_' + Date.now(),
          sender: 'assistant',
          content: res.finalOutput || 'Done executing operations.',
          trace: res.trace || []
        }
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorText(err.message || 'Failed to communicate with Copilot. Verify your API keys in Settings.');
      setMessages(prev => [
        ...prev,
        {
          id: 'assistant_err_' + Date.now(),
          sender: 'assistant',
          content: '⚠️ Failed to execute prompt engineering commands. Check details below.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    
    const cursor = inputRef.current?.selectionStart ?? 0;
    const textBeforeCursor = val.slice(0, cursor);
    
    // Find the last word ending at cursor position
    const lastWordMatch = textBeforeCursor.match(/[\w/@-]*$/);
    if (!lastWordMatch) {
      setSuggestionMode(null);
      return;
    }
    
    const word = lastWordMatch[0];
    if (word.startsWith('/')) {
      setSuggestionMode('slash');
      setTriggerIndex(cursor - word.length);
      const query = word.slice(1).toLowerCase();
      const commands = [
        { value: '/clear', label: 'Clear chat logs', type: 'command' },
        { value: '/export', label: 'Export conversation as Markdown', type: 'command' },
        { value: '/projects', label: 'List all playground projects', type: 'command' },
        { value: '/tools', label: 'List all custom sandbox tools', type: 'command' },
        { value: '/help', label: 'Show help and prompt examples', type: 'command' }
      ];
      const filtered = commands.filter(c => c.value.toLowerCase().includes('/' + query));
      setFilteredSuggestions(filtered);
      setActiveIndex(0);
    } else if (word.startsWith('@')) {
      setSuggestionMode('mention');
      setTriggerIndex(cursor - word.length);
      const query = word.slice(1).toLowerCase();
      
      const items: any[] = [];
      projectsList.forEach(proj => {
        items.push({ value: `@${proj.name}`, label: `Project: ${proj.name}`, type: 'project' });
        if (proj.prompts) {
          proj.prompts.forEach((pr: any) => {
            items.push({ value: `@${pr.name}`, label: `Prompt: ${pr.name} (in ${proj.name})`, type: 'prompt' });
          });
        }
      });
      toolsList.forEach(t => {
        items.push({ value: `@${t.name}`, label: `Tool: ${t.name}`, type: 'tool' });
      });

      const uniqueItems = items.filter((v, i, a) => a.findIndex(t => t.value === v.value) === i);
      const filtered = uniqueItems.filter(item => 
        item.value.toLowerCase().includes('@' + query) ||
        item.label.toLowerCase().includes(query)
      );
      setFilteredSuggestions(filtered.slice(0, 10));
      setActiveIndex(0);
    } else {
      setSuggestionMode(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestionMode && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % filteredSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(filteredSuggestions[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestionMode(null);
      }
    }
  };

  const selectSuggestion = (suggestion: any) => {
    const cursor = inputRef.current?.selectionStart ?? 0;
    const beforeTrigger = input.slice(0, triggerIndex);
    const afterCursor = input.slice(cursor);
    const replacement = suggestion.value + ' ';
    const newInput = beforeTrigger + replacement + afterCursor;
    setInput(newInput);
    setSuggestionMode(null);
    
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newCursorPos = triggerIndex + replacement.length;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  const handleSlashCommand = async (cmd: string) => {
    const parts = cmd.split(' ');
    const mainCmd = parts[0].toLowerCase();
    
    if (mainCmd === '/clear') {
      handleClear();
    } else if (mainCmd === '/export') {
      handleExportChat();
    } else if (mainCmd === '/help') {
      setMessages(prev => [
        ...prev,
        { id: 'user_help_' + Date.now(), sender: 'user', content: cmd },
        {
          id: 'assistant_help_' + Date.now(),
          sender: 'assistant',
          content: `💡 **PromptForge Copilot Shortcuts & Help**
          
* \`/clear\` - Clear chat history
* \`/export\` - Export chat history as Markdown
* \`/projects\` - List all playground projects & templates
* \`/tools\` - List all custom sandbox tools
* \`@projectName\` or \`@promptName\` - Quick mention to reference templates or tools`
        }
      ]);
    } else if (mainCmd === '/projects') {
      setMessages(prev => [
        ...prev,
        { id: 'user_proj_' + Date.now(), sender: 'user', content: cmd }
      ]);
      setLoading(true);
      try {
        const projs = await api.get('/api/projects');
        const content = projs.length === 0 
          ? "No projects found."
          : `📋 **Projects List:**\n\n` + projs.map((p: any) => `* **${p.name}** (\`${p.id}\`)\n` + (p.prompts || []).map((pr: any) => `  - _${pr.name}_ (\`${pr.id}\`)`).join('\n')).join('\n\n');
        
        setMessages(prev => [
          ...prev,
          { id: 'assistant_proj_' + Date.now(), sender: 'assistant', content }
        ]);
      } catch (err: any) {
        setMessages(prev => [
          ...prev,
          { id: 'assistant_proj_err_' + Date.now(), sender: 'assistant', content: `⚠️ Error fetching projects: ${err.message}` }
        ]);
      } finally {
        setLoading(false);
      }
    } else if (mainCmd === '/tools') {
      setMessages(prev => [
        ...prev,
        { id: 'user_tools_' + Date.now(), sender: 'user', content: cmd }
      ]);
      setLoading(true);
      try {
        const tools = await api.get('/api/tools');
        const content = tools.length === 0 
          ? "No tools found."
          : `🛠️ **Sandbox Tools List:**\n\n` + tools.map((t: any) => `* **${t.name}**: ${t.description}`).join('\n');
        
        setMessages(prev => [
          ...prev,
          { id: 'assistant_tools_' + Date.now(), sender: 'assistant', content }
        ]);
      } catch (err: any) {
        setMessages(prev => [
          ...prev,
          { id: 'assistant_tools_err_' + Date.now(), sender: 'assistant', content: `⚠️ Error fetching tools: ${err.message}` }
        ]);
      } finally {
        setLoading(false);
      }
    } else {
      setMessages(prev => [
        ...prev,
        { id: 'assistant_unknown_' + Date.now(), sender: 'assistant', content: `⚠️ Unknown slash command \`${mainCmd}\`. Type \`/help\` to see all commands.` }
      ]);
    }
  };

  const handleExportChat = () => {
    let md = `# PromptForge Copilot Chat Export - ${new Date().toLocaleDateString()}\n\n`;
    messages.forEach(msg => {
      const sender = msg.sender === 'user' ? 'User' : 'Copilot';
      md += `## ${sender}\n\n${msg.content}\n\n`;
      if (msg.trace && msg.trace.length > 0) {
        md += `### Executed Operations\n\n`;
        msg.trace.forEach((step, idx) => {
          md += `#### ${idx + 1}. ${step.name} (${step.status.toUpperCase()})\n`;
          md += `- **Arguments**:\n\`\`\`json\n${JSON.stringify(step.args, null, 2)}\n\`\`\`\n`;
          md += `- **Result**:\n\`\`\`json\n${JSON.stringify(step.result, null, 2)}\n\`\`\`\n\n`;
        });
      }
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copilot-chat-export-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setIsRecording(true);
    };

    rec.onresult = (event: any) => {
      const resultText = event.results[0][0].transcript;
      if (resultText) {
        setInput(prev => (prev ? prev + ' ' + resultText : resultText));
      }
    };

    rec.onerror = (event: any) => {
      console.error('Speech recognition error', event);
      setIsRecording(false);
    };

    rec.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const applyPromptBlock = (code: string, destination: 'system' | 'template') => {
    const data: any = {};
    if (destination === 'system') {
      data.systemInstruction = code;
    } else {
      data.template = code;
    }
    localStorage.setItem('copilot_applied_prompt', JSON.stringify(data));
    setApplyOverlayCode(null);
    window.dispatchEvent(new CustomEvent('switch-view', { detail: 'studio' }));
  };

  const handleCreateSession = () => {
    const newSessionId = 'session_' + Date.now();
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New Chat',
      messages: [
        {
          id: 'welcome',
          sender: 'assistant',
          content: 'Hi! I am your PromptForge Copilot. I can help you manage your prompt templates, projects, versions, branches, and custom agent tools.\n\nTry asking me:\n* "Show me all my projects"\n* "Create a new project named ReviewBot"\n* "Create a weather query tool script"\n* "Load the prompt Bug Finder and show me its details"\n* "Help me optimize my review template to be more creative"'
        }
      ],
      apiHistory: [],
      model: selectedModel,
      createdAt: Date.now()
    };
    
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSessionId);
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (sessionId === currentSessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0].id);
      } else {
        const defaultSessionId = 'session_default';
        const defaultSession: ChatSession = {
          id: defaultSessionId,
          title: 'Welcome Chat',
          messages: [
            {
              id: 'welcome',
              sender: 'assistant',
              content: 'Hi! I am your PromptForge Copilot. I can help you manage your prompt templates, projects, versions, branches, and custom agent tools.\n\nTry asking me:\n* "Show me all my projects"\n* "Create a new project named ReviewBot"\n* "Create a weather query tool script"\n* "Load the prompt Bug Finder and show me its details"\n* "Help me optimize my review template to be more creative"'
            }
          ],
          apiHistory: [],
          model: 'gemini-1.5-flash',
          createdAt: Date.now()
        };
        setSessions([defaultSession]);
        setCurrentSessionId(defaultSessionId);
        return;
      }
    }
    
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        content: 'Workspace cleared. How can I help you manage your prompt templates today?'
      }
    ]);
    setApiHistory([]);
    setInput('');
    setErrorText('');
  };

  const copyJson = (data: any, key: string) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setJsonCopied(key);
    setTimeout(() => setJsonCopied(null), 2000);
  };

  return (
    <div className="copilot-workspace fade-in" style={{ position: 'relative' }}>
      {/* Apply to Editor Overlay Modal */}
      {applyOverlayCode && (
        <div className="copilot-modal-backdrop" onClick={() => setApplyOverlayCode(null)}>
          <div className="copilot-modal glass-panel-glow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Apply Code to Prompt Studio</h3>
              <button className="modal-close" onClick={() => setApplyOverlayCode(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Where would you like to load this prompt snippet in the active editor?
              </p>
              <div className="modal-actions" style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="btn btn-primary modal-action-btn"
                  onClick={() => applyPromptBlock(applyOverlayCode, 'system')}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <ArrowRight size={14} /> System Instructions
                </button>
                <button 
                  className="btn btn-primary modal-action-btn"
                  onClick={() => applyPromptBlock(applyOverlayCode, 'template')}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <ArrowRight size={14} /> Prompt Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="copilot-header">
        <div className="header-title">
          <Bot size={22} className="copilot-logo-icon" />
          <div>
            <h2>Prompt Forge Copilot</h2>
            <p>Your AI assistant for managing projects, templates, and agent tools</p>
          </div>
        </div>

        <div className="copilot-model-selector">
          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AI Assistant Model</label>
          <select 
            value={selectedModel} 
            onChange={(e) => {
              setSelectedModel(e.target.value);
              setApiHistory([]); // Reset conversation when changing models to avoid formatting incompatibilities
            }}
            className="copilot-select"
          >
            {models.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="copilot-split-layout">
        {/* Left Sidebar Session Explorer */}
        <div className="copilot-sidebar glass-panel">
          <button className="new-chat-btn" onClick={handleCreateSession}>
            <Plus size={14} /> New Chat
          </button>
          
          <div className="sessions-list">
            {sessions.map(s => (
              <div 
                key={s.id} 
                className={`session-item ${s.id === currentSessionId ? 'active' : ''}`}
                onClick={() => setCurrentSessionId(s.id)}
              >
                <MessageSquare size={13} className="session-item-icon" />
                <span className="session-item-title" title={s.title}>{s.title}</span>
                {sessions.length > 1 && (
                  <button 
                    className="session-delete-btn" 
                    onClick={(e) => handleDeleteSession(s.id, e)}
                    title="Delete Chat"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Chat panel */}
        <div className="copilot-chat-area">
          {/* Main chat log container */}
          <div className="copilot-chat-container">
            <div className="copilot-chat-log">
              {messages.map((msg) => (
                <div key={msg.id} className={`copilot-bubble-row ${msg.sender}`}>
                  {msg.sender === 'assistant' && (
                    <div className="copilot-bubble-avatar">
                      <Bot size={16} />
                    </div>
                  )}
                  
                  <div className="copilot-bubble">
                    <div className="copilot-bubble-content">
                      {msg.sender === 'assistant' ? (
                        <MarkdownRenderer 
                          content={msg.content} 
                          enableCodeBlockActions={true}
                          onApplyToEditor={(code) => setApplyOverlayCode(code)}
                        />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>

                    {/* Expose execution traces if present */}
                    {msg.trace && msg.trace.length > 0 && (
                      <div className="copilot-trace-container">
                        <div className="trace-summary-header">
                          <span>⚙️ Executed {msg.trace.length} tool operation(s):</span>
                        </div>

                        <div className="trace-list">
                          {msg.trace.map((step, idx) => {
                            const stepKey = `${msg.id}_trace_${idx}`;
                            const isOpen = openTraceId === stepKey;
                            const isSuccess = step.status !== 'error';

                            return (
                              <div key={stepKey} className={`trace-step ${step.status}`}>
                                <div 
                                  className="trace-step-header" 
                                  onClick={() => setOpenTraceId(isOpen ? null : stepKey)}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span className={`trace-status-pill ${step.status}`}>
                                      {isSuccess ? 'SUCCESS' : 'ERROR'}
                                    </span>
                                    <span className="trace-tool-name">{step.name}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="trace-toggle-arrow">
                                      {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </span>
                                  </div>
                                </div>

                                {isOpen && (
                                  <div className="trace-step-details fade-in">
                                    <div className="trace-args">
                                      <strong>Arguments:</strong>
                                      <pre>{JSON.stringify(step.args, null, 2)}</pre>
                                    </div>
                                    <div className="trace-result-header">
                                      <strong>Output payload:</strong>
                                      <button 
                                        className="trace-copy-btn"
                                        onClick={() => copyJson(step.result, stepKey)}
                                      >
                                        {jsonCopied === stepKey ? <Check size={11} /> : <Copy size={11} />}
                                        {jsonCopied === stepKey ? 'Copied' : 'Copy'}
                                      </button>
                                    </div>
                                    <pre className="trace-result-block">
                                      {JSON.stringify(step.result, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="copilot-bubble-row assistant">
                  <div className="copilot-bubble-avatar">
                    <Bot size={16} />
                  </div>
                  <div className="copilot-bubble loading">
                    <div className="chat-typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}

              {errorText && (
                <div className="copilot-error-banner glass-panel">
                  <AlertCircle size={16} style={{ color: 'var(--error)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <strong>Copilot Error</strong>
                    <span>{errorText}</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Autocomplete Panel */}
          {suggestionMode && filteredSuggestions.length > 0 && (
            <div className="copilot-autocomplete-panel glass-panel">
              {filteredSuggestions.map((item, idx) => (
                <div 
                  key={item.value} 
                  className={`autocomplete-item ${idx === activeIndex ? 'active' : ''}`}
                  onClick={() => selectSuggestion(item)}
                >
                  <span className={`autocomplete-item-badge ${item.type}`}>
                    {item.type}
                  </span>
                  <span className="autocomplete-item-label">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Quick Command Chips */}
          <div className="copilot-chips-container">
            <button type="button" className="copilot-chip" onClick={() => handleInputChange('Show me all my projects')}>
              📋 List Projects
            </button>
            <button type="button" className="copilot-chip" onClick={() => handleInputChange('Show me all registered custom tools')}>
              🛠️ Show Tools
            </button>
            <button type="button" className="copilot-chip" onClick={() => handleInputChange('Create a new project named ')}>
              💡 Create Project
            </button>
            <button type="button" className="copilot-chip" onClick={handleExportChat}>
              <FileDown size={12} /> Export Chat
            </button>
            <button type="button" className="copilot-chip" onClick={() => handleInputChange('/help')}>
              <HelpCircle size={12} /> Shortcuts
            </button>
          </div>

          {/* Input Form Bar */}
          <form onSubmit={handleSend} className="copilot-input-form glass-panel">
            <input 
              ref={inputRef}
              type="text" 
              placeholder="Type / for commands, @ to reference templates, or speak your request..." 
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
            />
            <div className="copilot-input-actions">
              <button 
                type="button" 
                className={`copilot-mic-btn ${isRecording ? 'recording' : ''}`}
                onClick={startVoiceInput}
                title={isRecording ? 'Recording... Click to Stop' : 'Voice Input (Speech-to-Text)'}
                disabled={loading}
              >
                {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
              <button 
                type="submit" 
                className="btn btn-primary copilot-send-btn"
                disabled={loading || !input.trim()}
              >
                <SendHorizontal size={15} />
                Send
              </button>
              <button 
                type="button" 
                className="copilot-clear-btn"
                onClick={handleClear}
                title="Clear conversation"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
