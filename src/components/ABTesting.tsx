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

  const [activeSubTab, setActiveSubTab] = useState<'standard' | 'blind' | 'leaderboard'>('standard');
  const [eloRatings, setEloRatings] = useState<{ [modelName: string]: any }>({});
  
  // Blind Battle Arena state
  const [blindRunning, setBlindRunning] = useState(false);
  const [selectedBlindPool, setSelectedBlindPool] = useState<string[]>([
    'gemini-1.5-flash', 'gemini-1.5-pro', 'claude-3-5-sonnet-20241022', 'gpt-4o', 'gpt-4o-mini'
  ]);
  const [blindXModel, setBlindXModel] = useState('');
  const [blindYModel, setBlindYModel] = useState('');
  const [blindXOutput, setBlindXOutput] = useState('');
  const [blindYOutput, setBlindYOutput] = useState('');
  const [blindXError, setBlindXError] = useState('');
  const [blindYError, setBlindYError] = useState('');
  const [blindXMetrics, setBlindXMetrics] = useState<any | null>(null);
  const [blindYMetrics, setBlindYMetrics] = useState<any | null>(null);
  const [blindVoted, setBlindVoted] = useState<'X' | 'Y' | 'tie' | null>(null);
  const [eloChanges, setEloChanges] = useState<{ diffA: number; diffB: number } | null>(null);

  const loadElo = async () => {
    try {
      const res = await api.get('/api/elo');
      setEloRatings(res);
    } catch (e) {
      console.error('Error loading ELO:', e);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'leaderboard') {
      loadElo();
    }
  }, [activeSubTab]);

  const handleRunBlindBattle = async () => {
    if (!currentPrompt) return;
    if (selectedBlindPool.length < 2) {
      alert('Please select at least 2 candidate models in the pool for a blind battle.');
      return;
    }

    setBlindRunning(true);
    setBlindXOutput('');
    setBlindYOutput('');
    setBlindXError('');
    setBlindYError('');
    setBlindXMetrics(null);
    setBlindYMetrics(null);
    setBlindVoted(null);
    setEloChanges(null);

    // Randomly select two distinct models
    const shuffled = [...selectedBlindPool].sort(() => 0.5 - Math.random());
    const modelA = shuffled[0];
    const modelB = shuffled[1];

    setBlindXModel(modelA);
    setBlindYModel(modelB);

    // Get latest version
    const ver = currentPrompt.versions[currentPrompt.versions.length - 1];
    if (!ver) {
      setBlindRunning(false);
      return;
    }

    // Resolve variables
    let resolvedPrompt = ver.template;
    for (const [key, val] of Object.entries(variableValues)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      resolvedPrompt = resolvedPrompt.replace(regex, val);
    }

    // Run parallel
    await Promise.all([
      (async () => {
        try {
          const res = await api.post('/api/run', {
            model: modelA,
            systemInstruction: ver.systemInstruction,
            prompt: resolvedPrompt,
            temperature: 0.7,
            maxTokens: 1024
          });
          setBlindXOutput(res.output);
          setBlindXMetrics(res.metrics);
        } catch (err: any) {
          setBlindXError(err.message || 'Run failed');
        }
      })(),
      (async () => {
        try {
          const res = await api.post('/api/run', {
            model: modelB,
            systemInstruction: ver.systemInstruction,
            prompt: resolvedPrompt,
            temperature: 0.7,
            maxTokens: 1024
          });
          setBlindYOutput(res.output);
          setBlindYMetrics(res.metrics);
        } catch (err: any) {
          setBlindYError(err.message || 'Run failed');
        }
      })()
    ]);

    setBlindRunning(false);
  };

  const handleVoteBlind = async (winner: 'X' | 'Y' | 'tie') => {
    if (blindVoted) return; // already voted
    setBlindVoted(winner);

    const winnerParam = winner === 'X' ? 'A' : winner === 'Y' ? 'B' : 'tie';
    try {
      const res = await api.post('/api/elo/vote', {
        modelA: blindXModel,
        modelB: blindYModel,
        winner: winnerParam
      });
      setEloChanges({ diffA: res.diffA, diffB: res.diffB });
      
      // Also log the run historically
      await api.post('/api/runs', {
        run: {
          projectName: projects.find(p => p.id === selectedProjectId)?.name || 'Blind Battle',
          promptName: `${currentPrompt?.name} (Blind Battle Winner: ${winner === 'tie' ? 'Tie' : winner === 'X' ? blindXModel : blindYModel})`,
          model: `X:${blindXModel}, Y:${blindYModel}`,
          metrics: {
            durationMs: ((blindXMetrics?.durationMs || 0) + (blindYMetrics?.durationMs || 0)) / 2,
            tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
          },
          passed: true
        }
      });
    } catch (e) {
      console.error('Error logging blind vote:', e);
    }
  };

  const toggleBlindPoolModel = (modelVal: string) => {
    if (selectedBlindPool.includes(modelVal)) {
      if (selectedBlindPool.length <= 2) {
        alert('You must keep at least 2 models in the pool for random selection.');
        return;
      }
      setSelectedBlindPool(selectedBlindPool.filter(m => m !== modelVal));
    } else {
      setSelectedBlindPool([...selectedBlindPool, modelVal]);
    }
  };

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

      {/* Sub tabs navigation */}
      <div className="ab-tabs-nav">
        <button 
          className={`ab-tab-nav-btn ${activeSubTab === 'standard' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('standard')}
        >
          Standard A/B Arena
        </button>
        <button 
          className={`ab-tab-nav-btn ${activeSubTab === 'blind' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('blind')}
        >
          Blind Battle Arena
        </button>
        <button 
          className={`ab-tab-nav-btn ${activeSubTab === 'leaderboard' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('leaderboard')}
        >
          Model Elo Leaderboard
        </button>
      </div>

      {activeSubTab === 'standard' && (
        <>
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
        </>
      )}

      {activeSubTab === 'blind' && (
        <>
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

            {/* Candidate Model Pool selection */}
            {currentPrompt && (
              <div className="blind-pool-section">
                <h4>Candidate Model Pool (Select at least 2)</h4>
                <div className="blind-pool-grid">
                  {models.map(m => (
                    <label key={m.value} className="pool-checkbox-item">
                      <input 
                        type="checkbox"
                        checked={selectedBlindPool.includes(m.value)}
                        onChange={() => toggleBlindPoolModel(m.value)}
                      />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="controls-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="btn btn-primary"
                  onClick={handleRunBlindBattle}
                  disabled={!currentPrompt || blindRunning}
                >
                  <Play size={16} />
                  {blindRunning ? 'Running Blind Battle...' : 'Start Blind Battle'}
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

          {/* Blind Battle Grid */}
          {currentPrompt && (blindXModel || blindYModel) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="ab-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {/* Left Column (Model X) */}
                <div className="ab-column glass-panel">
                  <div className="column-header">
                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>Model X</span>
                    {blindVoted && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Revealed: <b>{models.find(m => m.value === blindXModel)?.label || blindXModel}</b>
                      </span>
                    )}
                  </div>
                  
                  <div className="column-output-area">
                    {blindRunning && !blindXOutput && !blindXError && (
                      <div className="column-status">
                        <div className="loading-spinner"></div>
                        <p>Running Model X...</p>
                      </div>
                    )}
                    {blindXError && (
                      <div className="column-error">
                        <AlertCircleIcon />
                        <p>{blindXError}</p>
                      </div>
                    )}
                    {blindXOutput && (
                      <div className="column-output-text">
                        {outputViewMode === 'raw' ? (
                          <pre>{blindXOutput}</pre>
                        ) : (
                          <MarkdownRenderer content={blindXOutput} />
                        )}
                      </div>
                    )}
                  </div>

                  {blindXMetrics && blindVoted && (
                    <div className="column-metrics-footer">
                      <div className="metric-tag">
                        <Clock size={12} />
                        <span>{blindXMetrics.durationMs}ms</span>
                      </div>
                      {blindXMetrics.tokenUsage && (
                        <div className="metric-tag">
                          <TrendingUp size={12} />
                          <span>{blindXMetrics.tokenUsage.totalTokens} tkn</span>
                        </div>
                      )}
                      {blindXMetrics.costEstimate !== undefined && (
                        <div className="metric-tag" style={{ border: '1px solid rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.05)', color: 'var(--success)' }}>
                          <span>${blindXMetrics.costEstimate.toFixed(5)}</span>
                        </div>
                      )}
                      {eloChanges && (
                        <span className={`elo-change-text ${eloChanges.diffA >= 0 ? 'plus' : 'minus'}`} style={{ marginLeft: 'auto', fontWeight: 600 }}>
                          {eloChanges.diffA >= 0 ? '+' : ''}{eloChanges.diffA} Elo
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column (Model Y) */}
                <div className="ab-column glass-panel">
                  <div className="column-header">
                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>Model Y</span>
                    {blindVoted && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Revealed: <b>{models.find(m => m.value === blindYModel)?.label || blindYModel}</b>
                      </span>
                    )}
                  </div>

                  <div className="column-output-area">
                    {blindRunning && !blindYOutput && !blindYError && (
                      <div className="column-status">
                        <div className="loading-spinner"></div>
                        <p>Running Model Y...</p>
                      </div>
                    )}
                    {blindYError && (
                      <div className="column-error">
                        <AlertCircleIcon />
                        <p>{blindYError}</p>
                      </div>
                    )}
                    {blindYOutput && (
                      <div className="column-output-text">
                        {outputViewMode === 'raw' ? (
                          <pre>{blindYOutput}</pre>
                        ) : (
                          <MarkdownRenderer content={blindYOutput} />
                        )}
                      </div>
                    )}
                  </div>

                  {blindYMetrics && blindVoted && (
                    <div className="column-metrics-footer">
                      <div className="metric-tag">
                        <Clock size={12} />
                        <span>{blindYMetrics.durationMs}ms</span>
                      </div>
                      {blindYMetrics.tokenUsage && (
                        <div className="metric-tag">
                          <TrendingUp size={12} />
                          <span>{blindYMetrics.tokenUsage.totalTokens} tkn</span>
                        </div>
                      )}
                      {blindYMetrics.costEstimate !== undefined && (
                        <div className="metric-tag" style={{ border: '1px solid rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.05)', color: 'var(--success)' }}>
                          <span>${blindYMetrics.costEstimate.toFixed(5)}</span>
                        </div>
                      )}
                      {eloChanges && (
                        <span className={`elo-change-text ${eloChanges.diffB >= 0 ? 'plus' : 'minus'}`} style={{ marginLeft: 'auto', fontWeight: 600 }}>
                          {eloChanges.diffB >= 0 ? '+' : ''}{eloChanges.diffB} Elo
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Blind Voting Actions Bar */}
              {!blindRunning && blindXOutput && blindYOutput && !blindVoted && (
                <div className="blind-actions-row">
                  <button className="btn-blind-vote btn-x" onClick={() => handleVoteBlind('X')}>
                    <Award size={14} style={{ marginRight: '4px' }} /> Model X is Better
                  </button>
                  <button className="btn-blind-vote btn-tie" onClick={() => handleVoteBlind('tie')}>
                    Draw (Tie)
                  </button>
                  <button className="btn-blind-vote btn-y" onClick={() => handleVoteBlind('Y')}>
                    <Award size={14} style={{ marginRight: '4px' }} /> Model Y is Better
                  </button>
                </div>
              )}

              {blindVoted && (
                <div className="reveal-card">
                  <span className="reveal-model-name">
                    {blindVoted === 'tie' 
                      ? 'Tie declared!' 
                      : `Model ${blindVoted} won this round!`}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Matchup: <b>{models.find(m => m.value === blindXModel)?.label || blindXModel}</b> vs <b>{models.find(m => m.value === blindYModel)?.label || blindYModel}</b>
                  </span>
                </div>
              )}
            </div>
          ) : (
            !blindRunning && (
              <div className="ab-empty-state">
                <Layers size={48} className="empty-icon" />
                <h3>Start a Blind Battle</h3>
                <p>Input prompt variables, select candidate models, and run the battle to evaluate models blindly.</p>
              </div>
            )
          )}
        </>
      )}

      {activeSubTab === 'leaderboard' && (
        <div className="leaderboard-wrapper glass-panel">
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
            <h3>Model Leaderboard</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Rankings computed using standard Elo ratings from blind head-to-head battles.</p>
          </div>
          <div style={{ padding: '20px', overflowX: 'auto' }}>
            {Object.keys(eloRatings).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <Award size={36} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <p>No ratings logged yet. Run a Blind Battle to initiate the rankings!</p>
              </div>
            ) : (
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th style={{ width: '80px' }}>Rank</th>
                    <th>Model Name</th>
                    <th>Elo Rating</th>
                    <th>Matches</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Ties</th>
                    <th>Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(eloRatings)
                    .sort((a, b) => b[1].elo - a[1].elo)
                    .map(([name, stats], index) => {
                      const rank = index + 1;
                      let rankClass = 'rank-other';
                      if (rank === 1) rankClass = 'rank-1';
                      else if (rank === 2) rankClass = 'rank-2';
                      else if (rank === 3) rankClass = 'rank-3';
                      
                      const winRate = stats.matches > 0 
                        ? ((stats.wins + stats.ties * 0.5) / stats.matches * 100).toFixed(1) 
                        : '0.0';

                      // Look up friendly label
                      const modelLabel = models.find(m => m.value === name)?.label || name;

                      return (
                        <tr key={name}>
                          <td>
                            <span className={`rank-badge ${rankClass}`}>{rank}</span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{modelLabel} <code style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>({name})</code></td>
                          <td style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '14px' }}>{stats.elo}</td>
                          <td>{stats.matches}</td>
                          <td style={{ color: 'var(--success)' }}>{stats.wins}</td>
                          <td style={{ color: 'var(--error)' }}>{stats.losses}</td>
                          <td>{stats.ties}</td>
                          <td style={{ fontWeight: 600 }}>{winRate}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
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
