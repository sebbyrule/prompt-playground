import React, { useState, useEffect } from 'react';
import './Settings.css';
import { Eye, EyeOff, Save, ShieldAlert } from 'lucide-react';

export const Settings: React.FC = () => {
  const [geminiKey, setGeminiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [lmStudioUrl, setLmStudioUrl] = useState('http://localhost:1234');
  
  const [showGemini, setShowGemini] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    // Load existing settings
    setGeminiKey(localStorage.getItem('gemini_api_key') || '');
    setClaudeKey(localStorage.getItem('claude_api_key') || '');
    setOpenaiKey(localStorage.getItem('openai_api_key') || '');
    setOllamaUrl(localStorage.getItem('ollama_url') || 'http://localhost:11434');
    setLmStudioUrl(localStorage.getItem('lmstudio_url') || 'http://localhost:1234');
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem('gemini_api_key', geminiKey.trim());
      localStorage.setItem('claude_api_key', claudeKey.trim());
      localStorage.setItem('openai_api_key', openaiKey.trim());
      localStorage.setItem('ollama_url', ollamaUrl.trim() || 'http://localhost:11434');
      localStorage.setItem('lmstudio_url', lmStudioUrl.trim() || 'http://localhost:1234');
      
      setStatusMessage({ text: 'API configuration saved successfully!', type: 'success' });
      
      setTimeout(() => {
        setStatusMessage(null);
      }, 3000);
    } catch (error) {
      setStatusMessage({ text: 'Failed to save configuration.', type: 'error' });
    }
  };

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear all stored keys?')) {
      localStorage.removeItem('gemini_api_key');
      localStorage.removeItem('claude_api_key');
      localStorage.removeItem('openai_api_key');
      localStorage.removeItem('ollama_url');
      localStorage.removeItem('lmstudio_url');
      
      setGeminiKey('');
      setClaudeKey('');
      setOpenaiKey('');
      setOllamaUrl('http://localhost:11434');
      setLmStudioUrl('http://localhost:1234');
      
      setStatusMessage({ text: 'All keys cleared.', type: 'success' });
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  return (
    <div className="settings-container fade-in">
      <div className="settings-header">
        <h1>API Settings</h1>
        <p>Configure API keys and endpoints for model testing. Keys are stored locally in your browser's local storage.</p>
      </div>

      <div className="settings-warning glass-panel">
        <ShieldAlert size={20} className="warning-icon" />
        <div>
          <h4>Security Notice</h4>
          <p>These keys are saved strictly in your local browser storage and sent as headers to your local backend. They are never sent to third-party tracking services or hosted cloud servers.</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="settings-form glass-panel">
        <div className="form-group">
          <label htmlFor="gemini">Gemini API Key</label>
          <div className="input-with-toggle">
            <input
              id="gemini"
              type={showGemini ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowGemini(!showGemini)}
            >
              {showGemini ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="help-text">Used for running Gemini models and the meta-prompt auto-optimizer.</small>
        </div>

        <div className="form-group">
          <label htmlFor="claude">Claude / Anthropic API Key</label>
          <div className="input-with-toggle">
            <input
              id="claude"
              type={showClaude ? 'text' : 'password'}
              placeholder="sk-ant-..."
              value={claudeKey}
              onChange={(e) => setClaudeKey(e.target.value)}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowClaude(!showClaude)}
            >
              {showClaude ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="help-text">Used for running Claude 3 and Claude 3.5 models.</small>
        </div>

        <div className="form-group">
          <label htmlFor="openai">OpenAI API Key</label>
          <div className="input-with-toggle">
            <input
              id="openai"
              type={showOpenai ? 'text' : 'password'}
              placeholder="sk-proj-..."
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowOpenai(!showOpenai)}
            >
              {showOpenai ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="help-text">Used for running GPT-4o, o1, o3, etc.</small>
        </div>

        <div className="form-group">
          <label htmlFor="ollama">Local Ollama API Endpoint</label>
          <input
            id="ollama"
            type="text"
            placeholder="http://localhost:11434"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
          />
          <small className="help-text">Used for running models hosted locally on your machine. Ensure Ollama is running.</small>
        </div>

        <div className="form-group">
          <label htmlFor="lmstudio">LM Studio API Endpoint</label>
          <input
            id="lmstudio"
            type="text"
            placeholder="http://localhost:1234"
            value={lmStudioUrl}
            onChange={(e) => setLmStudioUrl(e.target.value)}
          />
          <small className="help-text">Used for running models hosted locally in LM Studio. Ensure LM Studio server is running.</small>
        </div>

        {statusMessage && (
          <div className={`status-banner ${statusMessage.type}`}>
            {statusMessage.text}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            <Save size={16} />
            Save Configuration
          </button>
          <button type="button" className="btn btn-secondary btn-danger-hover" onClick={handleClear}>
            Clear Stored Keys
          </button>
        </div>
      </form>

      <div className="gateway-docs-panel glass-panel" style={{ marginTop: '20px', padding: '24px' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Local Gateway API (Prompt Serving)</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' }}>
          Query your saved prompts programmatically from your own Python, JavaScript, or bash scripts. Make a POST request to your local playground proxy server:
        </p>
        <pre style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: '12px', border: '1px solid var(--border-color)', overflowX: 'auto', marginBottom: '14px' }}>
          {`POST http://localhost:5001/api/serve/<PROMPT_ID>`}
        </pre>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Example Request Payload:</span>
        <pre style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: '11px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
{`{
  "variables": {
    "topic": "Vite",
    "language": "TypeScript"
  },
  "version": "latest" // optional version number, e.g. 1
}`}
        </pre>
      </div>
    </div>
  );
};
