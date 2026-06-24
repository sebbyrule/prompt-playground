import React, { useState, useEffect } from 'react';
import './ABTesting.css';
import api from '../utils/api';
import { 
  Play, 
  Plus, 
  Trash2, 
  Clock, 
  TrendingUp, 
  Award,
  Layers,
  HelpCircle
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface PromptVersion {
  version: number;
  systemInstruction: string;
  template: string;
  variables: string[];
  parameters: { temperature: number; maxTokens: number };
  createdAt: string;
  description: string;
}

interface Prompt {
  id: string;
  name: string;
  versions: PromptVersion[];
}

interface Project {
  id: string;
  name: string;
  prompts: Prompt[];
}

interface ABVariant {
  id: string;
  name: string;
  selectedVersion: number;
  selectedModel: string;
  temperature: number;
  maxTokens: number;
  output: string;
  running: boolean;
  error: string;
  metrics: {
    durationMs: number;
    costEstimate?: number;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  } | null;
}

export const ABTesting: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState('');
  
  // Prompt details
  const [currentPrompt, setCurrentPrompt] = useState<Prompt | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  const [variableValues, setVariableValues] = useState<{ [key: string]: string }>({});
  
  // Variants (Multiple parallel runners)
  const [variants, setVariants] = useState<ABVariant[]>([
    {
      id: 'var_1',
      name: 'Variant A',
      selectedVersion: 1,
      selectedModel: 'gemini-1.5-flash',
      temperature: 0.7,
      maxTokens: 1024,
      output: '',
      running: false,
      error: '',
      metrics: null
    },
    {
      id: 'var_2',
      name: 'Variant B',
      selectedVersion: 1,
      selectedModel: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 1024,
      output: '',
      running: false,
      error: '',
      metrics: null
    }
  ]);

  const [voteLogged, setVoteLogged] = useState<string | null>(null);
  const [outputViewMode, setOutputViewMode] = useState<'raw' | 'preview'>('raw');

  const models = [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'ollama/llama3', label: 'Ollama: Llama 3' },
    { value: 'ollama/mistral', label: 'Ollama: Mistral' },
    { value: 'lmstudio/local-model', label: 'LM Studio: Local Model' },
  ];

  useEffect(() => {
    async function loadProjects() {
      try {
        const projs = await api.get('/api/projects');
        setProjects(projs);
        if (projs.length > 0) {
          setSelectedProjectId(projs[0].id);
        }
      } catch (e) {
        console.error(e);
      }
    }
    loadProjects();
  }, []);

  // When project changes, select first prompt
  useEffect(() => {
    if (!selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    if (proj && proj.prompts && proj.prompts.length > 0) {
      setSelectedPromptId(proj.prompts[0].id);
    } else {
      setSelectedPromptId('');
      setCurrentPrompt(null);
      setVariables([]);
    }
  }, [selectedProjectId, projects]);

  // When prompt changes, fetch prompt details
  useEffect(() => {
    if (!selectedPromptId || !selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    const prompt = proj?.prompts.find(p => p.id === selectedPromptId);
    
    if (prompt) {
      setCurrentPrompt(prompt);
      
      // Select latest version variables as base
      const latestVer = prompt.versions[prompt.versions.length - 1];
      setVariables(latestVer.variables || []);
      
      const vars: { [key: string]: string } = {};
      latestVer.variables.forEach(v => {
        vars[v] = '';
      });
      setVariableValues(vars);

      // Default the variants to select the latest prompt version
      setVariants(prev => prev.map(v => ({
        ...v,
        selectedVersion: prompt.versions.length
      })));
    }
  }, [selectedPromptId, selectedProjectId, projects]);

  const addVariant = () => {
    if (variants.length >= 4) {
      alert('Maximum of 4 variants supported in visual workspace.');
      return;
    }
    const id = 'var_' + Math.random().toString(36).substr(2, 9);
    const letter = String.fromCharCode(65 + variants.length); // C, D...
    setVariants([
      ...variants,
      {
        id,
        name: `Variant ${letter}`,
        selectedVersion: currentPrompt ? currentPrompt.versions.length : 1,
        selectedModel: 'gemini-1.5-flash',
        temperature: 0.7,
        maxTokens: 1024,
        output: '',
        running: false,
        error: '',
        metrics: null
      }
    ]);
  };

  const removeVariant = (id: string) => {
    if (variants.length <= 1) return;
    setVariants(variants.filter(v => v.id !== id));
  };

  const updateVariant = (id: string, updates: Partial<ABVariant>) => {
    setVariants(variants.map(v => v.id === id ? { ...v, ...updates } : v));
  };

  const handleRunABTest = async () => {
    if (!currentPrompt) return;
    setVoteLogged(null);

    // Prepare execution list
    const updatedVariants = variants.map(v => ({
      ...v,
      running: true,
      output: '',
      error: '',
      metrics: null
    }));
    setVariants(updatedVariants);

    // Parallel calls
    await Promise.all(updatedVariants.map(async (variant) => {
      try {
        const ver = currentPrompt.versions.find(v => v.version === variant.selectedVersion);
        if (!ver) throw new Error('Selected prompt version not found');

        // Resolve variables in template
        let resolvedPrompt = ver.template;
        for (const [key, val] of Object.entries(variableValues)) {
          const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
          resolvedPrompt = resolvedPrompt.replace(regex, val);
        }

        const res = await api.post('/api/run', {
          model: variant.selectedModel,
          systemInstruction: ver.systemInstruction,
          prompt: resolvedPrompt,
          temperature: variant.temperature,
          maxTokens: variant.maxTokens
        });

        updateVariant(variant.id, {
          running: false,
          output: res.output,
          metrics: res.metrics
        });
      } catch (err: any) {
        updateVariant(variant.id, {
          running: false,
          error: err.message || 'Run failed'
        });
      }
    }));
  };

  const handleVoteBest = async (winnerName: string) => {
    setVoteLogged(winnerName);
    
    // Log the event to our runs DB
    try {
      await api.post('/api/runs', {
        run: {
          projectName: projects.find(p => p.id === selectedProjectId)?.name || 'A/B Testing',
          promptName: `${currentPrompt?.name} (A/B Test Vote: ${winnerName})`,
          model: variants.map(v => `${v.name}:${v.selectedModel}`).join(', '),
          metrics: {
            durationMs: variants.reduce((sum, v) => sum + (v.metrics?.durationMs || 0), 0) / variants.length,
            tokenUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0
            }
          },
          passed: true // vote counts as positive evaluation
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="ab-container fade-in">
      <div className="ab-header">
        <h1>A/B Testing Arena</h1>
        <p>Compare different configurations, prompt versions, or LLMs side-by-side to find the optimal setup.</p>
      </div>

      {/* Control panel */}
      <div className="ab-controls-panel glass-panel">
        <div className="controls-row">
          <div className="control-group">
            <label>Select Project</label>
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">-- Choose Project --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Select Prompt</label>
            <select value={selectedPromptId} onChange={(e) => setSelectedPromptId(e.target.value)} disabled={!selectedProjectId}>
              <option value="">-- Choose Prompt --</option>
              {selectedProjectId && projects.find(p => p.id === selectedProjectId)?.prompts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Variable Inputs */}
        {variables.length > 0 && (
          <div className="variables-section">
            <h4>Define Prompt Input Variables</h4>
            <div className="variables-grid">
              {variables.map(v => (
                <div key={v} className="variable-field">
                  <label className="var-label">{v}</label>
                  <input
                    type="text"
                    placeholder={`Insert value for {{${v}}}`}
                    value={variableValues[v] || ''}
                    onChange={(e) => setVariableValues({
                      ...variableValues,
                      [v]: e.target.value
                    })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="controls-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn btn-primary"
              onClick={handleRunABTest}
              disabled={!currentPrompt || variants.some(v => v.running)}
            >
              <Play size={16} />
              {variants.some(v => v.running) ? 'Executing Comparison...' : 'Run Comparison'}
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={addVariant}
              disabled={variants.length >= 4}
            >
              <Plus size={16} />
              Add Variant Column
            </button>
          </div>
          {currentPrompt && (
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <button 
                className="btn-secondary-mini"
                onClick={() => setOutputViewMode('raw')}
                style={{ padding: '4px 10px', fontSize: '11px', background: outputViewMode === 'raw' ? 'var(--accent-primary)' : 'transparent', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
              >
                Raw
              </button>
              <button 
                className="btn-secondary-mini"
                onClick={() => setOutputViewMode('preview')}
                style={{ padding: '4px 10px', fontSize: '11px', background: outputViewMode === 'preview' ? 'var(--accent-primary)' : 'transparent', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
              >
                Preview
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Comparison Grid */}
      {currentPrompt ? (
        <div className="ab-grid" style={{ gridTemplateColumns: `repeat(${variants.length}, 1fr)` }}>
          {variants.map((variant) => (
            <div key={variant.id} className="ab-column glass-panel">
              {/* Column Settings Header */}
              <div className="column-header">
                <input
                  type="text"
                  className="variant-name-input"
                  value={variant.name}
                  onChange={(e) => updateVariant(variant.id, { name: e.target.value })}
                />
                
                {variants.length > 1 && (
                  <button className="col-remove-btn" onClick={() => removeVariant(variant.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="column-settings">
                <div className="setting-item">
                  <label>Version</label>
                  <select 
                    value={variant.selectedVersion}
                    onChange={(e) => updateVariant(variant.id, { selectedVersion: parseInt(e.target.value) })}
                  >
                    {currentPrompt.versions.map(v => (
                      <option key={v.version} value={v.version}>v{v.version} ({v.description})</option>
                    ))}
                  </select>
                </div>

                <div className="setting-item">
                  <label>Model</label>
                  <select 
                    value={variant.selectedModel}
                    onChange={(e) => updateVariant(variant.id, { selectedModel: e.target.value })}
                  >
                    {models.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="settings-row-mini">
                  <div className="setting-item">
                    <label>Temp: {variant.temperature}</label>
                    <input 
                      type="range" 
                      min="0" 
                      max="1.5" 
                      step="0.1" 
                      value={variant.temperature} 
                      onChange={(e) => updateVariant(variant.id, { temperature: parseFloat(e.target.value) })} 
                    />
                  </div>
                  <div className="setting-item">
                    <label>Max Tokens</label>
                    <input 
                      type="number" 
                      className="max-tokens-mini"
                      value={variant.maxTokens} 
                      onChange={(e) => updateVariant(variant.id, { maxTokens: parseInt(e.target.value) || 128 })} 
                    />
                  </div>
                </div>
              </div>

              {/* Output Content */}
              <div className="column-output-area">
                {variant.running && (
                  <div className="column-status">
                    <div className="loading-spinner"></div>
                    <p>Invoking model API...</p>
                  </div>
                )}

                {variant.error && (
                  <div className="column-error">
                    <AlertCircleIcon />
                    <p>{variant.error}</p>
                  </div>
                )}

                {!variant.running && !variant.error && variant.output && (
                  <div className="column-output-text">
                    {outputViewMode === 'raw' ? (
                      <pre>{variant.output}</pre>
                    ) : (
                      <MarkdownRenderer content={variant.output} />
                    )}
                  </div>
                )}
                
                {!variant.running && !variant.error && !variant.output && (
                  <div className="column-output-empty">
                    <HelpCircle size={28} className="empty-icon" />
                    <p>Configure and run comparison to see output.</p>
                  </div>
                )}
              </div>

              {/* Metrics Footer */}
              {variant.metrics && (
                <div className="column-metrics-footer">
                  <div className="metric-tag">
                    <Clock size={12} />
                    <span>{variant.metrics.durationMs}ms</span>
                  </div>
                  {variant.metrics.tokenUsage && (
                    <div className="metric-tag">
                      <TrendingUp size={12} />
                      <span>{variant.metrics.tokenUsage.totalTokens} tkn</span>
                    </div>
                  )}
                  {variant.metrics.costEstimate !== undefined && (
                    <div className="metric-tag" style={{ border: '1px solid rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.05)', color: 'var(--success)' }}>
                      <span>${variant.metrics.costEstimate.toFixed(5)}</span>
                    </div>
                  )}
                  
                  {/* Rating Actions */}
                  {!voteLogged ? (
                    <button 
                      className="btn-vote" 
                      title="Vote as Best Output"
                      onClick={() => handleVoteBest(variant.name)}
                    >
                      <Award size={14} /> Vote Best
                    </button>
                  ) : (
                    voteLogged === variant.name && (
                      <span className="vote-badge">
                        <Award size={14} /> Winner
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="ab-empty-state">
          <Layers size={48} className="empty-icon" />
          <h3>Select a Prompt to Begin A/B Testing</h3>
          <p>Choose an active project and prompt to set up side-by-side variants comparison.</p>
        </div>
      )}
    </div>
  );
};

const AlertCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="col-err-icon">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </svg>
);

export default ABTesting;
