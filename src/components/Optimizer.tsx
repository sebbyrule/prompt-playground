import React, { useState, useEffect } from 'react';
import './Optimizer.css';
import api from '../utils/api';
import {
  Sparkles, 
  HelpCircle, 
  ThumbsUp, 
  AlertCircle,
  Code2
} from 'lucide-react';

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

interface OptimizedCandidate {
  name: string;
  systemInstruction: string;
  template: string;
  explanation: string;
}

export const Optimizer: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState('');
  
  // Prompt State
  const [currentPrompt, setCurrentPrompt] = useState<Prompt | null>(null);
  const [systemInstruction, setSystemInstruction] = useState('');
  const [template, setTemplate] = useState('');

  // User input goals
  const [improvementGoal, setImprovementGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [failureCases, setFailureCases] = useState('');

  // Results
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<OptimizedCandidate[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadData() {
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
    loadData();
  }, []);

  // Sync selection
  useEffect(() => {
    if (!selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    if (proj && proj.prompts && proj.prompts.length > 0) {
      setSelectedPromptId(proj.prompts[0].id);
    } else {
      setSelectedPromptId('');
      setCurrentPrompt(null);
    }
  }, [selectedProjectId, projects]);

  useEffect(() => {
    if (!selectedPromptId || !selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    const prompt = proj?.prompts.find(p => p.id === selectedPromptId);
    
    if (prompt) {
      setCurrentPrompt(prompt);
      const latestVer = prompt.versions[prompt.versions.length - 1];
      setSystemInstruction(latestVer.systemInstruction || '');
      setTemplate(latestVer.template || '');
      
      // Clear previous suggestions
      setCandidates([]);
      setSelectedCandidateIndex(null);
      setError('');
    }
  }, [selectedPromptId, selectedProjectId, projects]);

  const handleOptimize = async () => {
    if (!selectedPromptId || !improvementGoal.trim()) return;

    setRunning(true);
    setCandidates([]);
    setSelectedCandidateIndex(null);
    setError('');

    try {
      const res = await api.post('/api/optimize', {
        systemInstruction,
        template,
        improvementGoal,
        successCriteria,
        failureCases
      });

      if (res.candidates && res.candidates.length > 0) {
        setCandidates(res.candidates);
        setSelectedCandidateIndex(0); // auto-select first suggestion
      } else {
        throw new Error('Optimizer did not return any candidates. Try refining your goal.');
      }
    } catch (e: any) {
      setError(e.message || 'Optimization failed. Verify your Gemini API Key is in Settings.');
    } finally {
      setRunning(false);
    }
  };

  const handleApplyCandidate = async () => {
    if (selectedCandidateIndex === null || !currentPrompt || !activeProjectObj) return;
    const candidate = candidates[selectedCandidateIndex];
    
    try {
      const desc = `Auto-Optimized: ${candidate.name}`;
      
      // Save optimized candidate as a new prompt version
      await api.post(`/api/projects/${activeProjectObj.id}/prompts/${currentPrompt.id}/versions`, {
        systemInstruction: candidate.systemInstruction,
        template: candidate.template,
        parameters: currentPrompt.versions[currentPrompt.versions.length - 1].parameters,
        description: desc
      });

      alert(`Successfully saved optimized "${candidate.name}" as new version in Prompt Studio!`);
      
      // Refresh current states
      setCandidates([]);
      setSelectedCandidateIndex(null);
      setImprovementGoal('');
      setSuccessCriteria('');
      setFailureCases('');
      
      // Reload projects list to sync version counters
      const projs = await api.get('/api/projects');
      setProjects(projs);
    } catch (e: any) {
      alert(`Failed to apply candidate: ${e.message}`);
    }
  };

  const activeProjectObj = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="opt-container fade-in">
      <div className="opt-header">
        <h1>Auto-Improvement Optimizer</h1>
        <p>Harness advanced meta-prompting to automatically rewrite and improve your system instructions and templates.</p>
      </div>

      {/* Selector and Inputs Panel */}
      <div className="opt-inputs-grid">
        <div className="opt-form-panel glass-panel">
          <div className="opt-selector-row">
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
                {selectedProjectId && activeProjectObj?.prompts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group-opt">
            <label htmlFor="goal">What would you like to improve?</label>
            <textarea
              id="goal"
              rows={2}
              placeholder="e.g. Make it more concise, format strictly as JSON, ensure it output bullet points, handle edge cases better..."
              value={improvementGoal}
              onChange={(e) => setImprovementGoal(e.target.value)}
              disabled={!selectedPromptId}
            />
          </div>

          <div className="form-group-opt">
            <label htmlFor="criteria">Target Success Criteria (Optional)</label>
            <input
              id="criteria"
              type="text"
              placeholder="e.g. Output contains exactly 3 steps; Tone is highly professional..."
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              disabled={!selectedPromptId}
            />
          </div>

          <div className="form-group-opt">
            <label htmlFor="failures">Failure Cases to Avoid (Optional)</label>
            <input
              id="failures"
              type="text"
              placeholder="e.g. Do not include introductory text; Avoid saying 'Sure, here is the...'"
              value={failureCases}
              onChange={(e) => setFailureCases(e.target.value)}
              disabled={!selectedPromptId}
            />
          </div>

          <button 
            className="btn btn-primary optimize-trigger-btn"
            onClick={handleOptimize}
            disabled={running || !selectedPromptId || !improvementGoal.trim()}
          >
            <Sparkles size={16} />
            {running ? 'Engineering Prompts...' : 'Generate Optimized Prompts'}
          </button>
        </div>

        {/* Current Prompt Preview box */}
        {selectedPromptId && (
          <div className="opt-current-preview glass-panel">
            <div className="preview-header">
              <h4>Current Active Prompt</h4>
            </div>
            <div className="preview-body">
              <div className="preview-section">
                <span>System:</span>
                <pre>{systemInstruction || '(Empty)'}</pre>
              </div>
              <div className="preview-section">
                <span>Template:</span>
                <pre>{template || '(Empty)'}</pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Output / Optimization recommendations */}
      {running && (
        <div className="optimizer-running-screen glass-panel">
          <div className="running-animation-wrapper">
            <Sparkles size={36} className="running-sparkle" />
            <div className="running-pulse"></div>
          </div>
          <h4>Analyzing Prompt & Applying Meta-Prompting...</h4>
          <p>This runs a prompt synthesis routine using Gemini to construct three candidate prompt architectures.</p>
        </div>
      )}

      {error && (
        <div className="optimizer-error glass-panel">
          <AlertCircle size={20} className="error-icon" />
          <div>
            <h4>Optimization Failed</h4>
            <p>{error}</p>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="optimization-results-panel">
          <h3>Optimized Candidates</h3>
          
          <div className="candidates-tab-row">
            {candidates.map((cand, idx) => (
              <button 
                key={idx} 
                className={`candidate-tab-btn glass-panel ${selectedCandidateIndex === idx ? 'active' : ''}`}
                onClick={() => setSelectedCandidateIndex(idx)}
              >
                <Code2 size={16} />
                <div>
                  <strong>{cand.name}</strong>
                  <span>Candidate {idx + 1}</span>
                </div>
              </button>
            ))}
          </div>

          {selectedCandidateIndex !== null && (
            <div className="selected-candidate-viewer glass-panel-glow fade-in">
              <div className="candidate-header">
                <div>
                  <h4>{candidates[selectedCandidateIndex].name}</h4>
                  <p className="candidate-explanation">{candidates[selectedCandidateIndex].explanation}</p>
                </div>
                <button className="btn btn-primary" onClick={handleApplyCandidate}>
                  <ThumbsUp size={16} /> Apply as New Version
                </button>
              </div>

              <div className="candidate-comparison-grid">
                <div className="comparison-card">
                  <h5>Optimized System Instructions</h5>
                  <pre className="comparison-content">
                    {candidates[selectedCandidateIndex].systemInstruction || '(Empty)'}
                  </pre>
                </div>

                <div className="comparison-card">
                  <h5>Optimized User Prompt Template</h5>
                  <pre className="comparison-content">
                    {candidates[selectedCandidateIndex].template || '(Empty)'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!running && candidates.length === 0 && !error && (
        <div className="opt-empty-state">
          <HelpCircle size={48} className="empty-icon" />
          <h3>Optimization Dashboard</h3>
          <p>Select a prompt, type in your improvement goal, and let the AI rewrite it using industry best practices.</p>
        </div>
      )}
    </div>
  );
};
export default Optimizer;
