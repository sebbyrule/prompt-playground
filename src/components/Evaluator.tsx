import React, { useState, useEffect } from 'react';
import './Evaluator.css';
import api from '../utils/api';
import { 
  Play, 
  Plus, 
  Trash2, 
  Layers, 
  CheckCircle2, 
  XCircle, 
  PlusCircle, 
  Save, 
  AlertTriangle 
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Assertion {
  type: 'contains' | 'not_contains' | 'regex' | 'llm_judge';
  value: string;
}

interface TestCase {
  id: string;
  name: string;
  variables: { [key: string]: string };
  assertions: Assertion[];
}

interface PromptVersion {
  version: number;
  systemInstruction: string;
  template: string;
  variables: string[];
  parameters: { temperature: number; maxTokens: number };
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

export const Evaluator: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');

  // Active prompt details
  const [currentPrompt, setCurrentPrompt] = useState<Prompt | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  
  // Test cases state
  const [testCases, setTestCaseStates] = useState<TestCase[]>([]);
  
  // Evaluation Run results
  const [runResults, setRunResults] = useState<any | null>(null);
  const [running, setRunning] = useState(false);
  const [savingSuite, setSavingSuite] = useState(false);
  const [outputViewMode, setOutputViewMode] = useState<'raw' | 'preview'>('raw');

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
    async function loadData() {
      try {
        const projs = await api.get('/api/projects');
        setProjects(projs);
        if (projs.length > 0) {
          setSelectedProjectId(projs[0].id);
        }

        // Try to load saved evaluation suite if exists
        const suites = await api.get('/api/evaluations');
        if (suites.length > 0) {
          // If we have saved evaluations, we can parse them, but we'll bind them per prompt below.
        }
      } catch (e) {
        console.error(e);
      }
    }
    loadData();
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

  // When prompt changes, set up variables and check if we have saved test suites
  useEffect(() => {
    if (!selectedPromptId || !selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    const prompt = proj?.prompts.find(p => p.id === selectedPromptId);
    
    if (prompt) {
      setCurrentPrompt(prompt);
      setSelectedVersion(prompt.versions.length);
      
      const latestVer = prompt.versions[prompt.versions.length - 1];
      setVariables(latestVer.variables || []);
      setRunResults(null);

      // Attempt to load saved test suite for this prompt
      loadSavedSuite(prompt.id);
    }
  }, [selectedPromptId, selectedProjectId, projects]);

  const loadSavedSuite = async (promptId: string) => {
    try {
      const suites = await api.get('/api/evaluations');
      const matched = suites.find((s: any) => s.promptId === promptId);
      if (matched && matched.testCases) {
        setTestCaseStates(matched.testCases);
      } else {
        // Scaffold default single test case
        setTestCaseStates([
          {
            id: 'tc_' + Math.random().toString(36).substr(2, 9),
            name: 'Test Case 1',
            variables: {},
            assertions: [
              { type: 'contains', value: '' }
            ]
          }
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addTestCase = () => {
    const id = 'tc_' + Math.random().toString(36).substr(2, 9);
    setTestCaseStates([
      ...testCases,
      {
        id,
        name: `Test Case ${testCases.length + 1}`,
        variables: {},
        assertions: [{ type: 'contains', value: '' }]
      }
    ]);
  };

  const removeTestCase = (id: string) => {
    if (testCases.length <= 1) return;
    setTestCaseStates(testCases.filter(tc => tc.id !== id));
  };

  const updateTestCaseVariable = (tcId: string, varName: string, value: string) => {
    setTestCaseStates(testCases.map(tc => {
      if (tc.id === tcId) {
        return {
          ...tc,
          variables: {
            ...tc.variables,
            [varName]: value
          }
        };
      }
      return tc;
    }));
  };

  const updateTestCaseName = (tcId: string, name: string) => {
    setTestCaseStates(testCases.map(tc => tc.id === tcId ? { ...tc, name } : tc));
  };

  const addAssertion = (tcId: string) => {
    setTestCaseStates(testCases.map(tc => {
      if (tc.id === tcId) {
        return {
          ...tc,
          assertions: [...tc.assertions, { type: 'contains', value: '' }]
        };
      }
      return tc;
    }));
  };

  const removeAssertion = (tcId: string, index: number) => {
    setTestCaseStates(testCases.map(tc => {
      if (tc.id === tcId) {
        return {
          ...tc,
          assertions: tc.assertions.filter((_, idx) => idx !== index)
        };
      }
      return tc;
    }));
  };

  const updateAssertion = (tcId: string, index: number, updates: Partial<Assertion>) => {
    setTestCaseStates(testCases.map(tc => {
      if (tc.id === tcId) {
        return {
          ...tc,
          assertions: tc.assertions.map((ast, idx) => idx === index ? { ...ast, ...updates } : ast)
        };
      }
      return tc;
    }));
  };

  const handleSaveSuite = async () => {
    if (!selectedPromptId) return;
    setSavingSuite(true);
    try {
      const newSuite = {
        promptId: selectedPromptId,
        testCases
      };
      
      // Save it (our backend appends/inserts new item)
      await api.post('/api/evaluations', { evaluation: newSuite });
      alert('Test suite saved successfully to local workspace!');
    } catch (e) {
      console.error(e);
      alert('Failed to save test suite.');
    } finally {
      setSavingSuite(false);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      if (file.name.endsWith('.json')) {
        parseJsonDataset(text);
      } else if (file.name.endsWith('.csv')) {
        parseCsvDataset(text);
      } else {
        alert('Unsupported file format. Please upload a .json or .csv file.');
      }
    };
    reader.readAsText(file);
    // Clear the input value so that importing the same file again triggers change event
    e.target.value = '';
  };

  const parseJsonDataset = (rawText: string) => {
    try {
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error('JSON dataset must be an array of test cases.');
      }

      const importedCases: TestCase[] = parsed.map((item, idx) => {
        const caseVars: { [key: string]: string } = {};
        if (item.variables && typeof item.variables === 'object') {
          for (const [k, v] of Object.entries(item.variables)) {
            caseVars[k] = String(v);
          }
        }

        const caseAssertions: Assertion[] = [];
        if (Array.isArray(item.assertions)) {
          item.assertions.forEach((ast: any) => {
            if (ast && ast.type && ast.value !== undefined) {
              caseAssertions.push({
                type: ast.type,
                value: String(ast.value)
              });
            }
          });
        }

        if (caseAssertions.length === 0) {
          caseAssertions.push({ type: 'contains', value: '' });
        }

        return {
          id: 'tc_' + Math.random().toString(36).substr(2, 9) + '_' + idx,
          name: item.name || `Imported Case ${idx + 1}`,
          variables: caseVars,
          assertions: caseAssertions
        };
      });

      setTestCaseStates([...testCases, ...importedCases]);
      alert(`Successfully imported ${importedCases.length} test cases from JSON!`);
    } catch (e: any) {
      alert(`Failed to parse JSON dataset: ${e.message}`);
    }
  };

  const parseCsvDataset = (rawText: string) => {
    try {
      const parseCsvLine = (line: string) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) {
        throw new Error('CSV must contain a header row and at least one data row.');
      }

      const headers = parseCsvLine(lines[0]);
      const importedCases: TestCase[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

        const caseVars: { [key: string]: string } = {};
        let caseName = `CSV Case ${i}`;
        const caseAssertions: Assertion[] = [];

        headers.forEach((header, idx) => {
          const val = row[idx] || '';
          const lowerHeader = header.toLowerCase();

          if (lowerHeader === 'case_name' || lowerHeader === 'name') {
            caseName = val;
          } else if (lowerHeader === 'expected_contains' || lowerHeader === 'expected_output' || lowerHeader === 'assertion_contains') {
            if (val) {
              caseAssertions.push({ type: 'contains', value: val });
            }
          } else if (lowerHeader === 'assertion_not_contains') {
            if (val) {
              caseAssertions.push({ type: 'not_contains', value: val });
            }
          } else {
            caseVars[header] = val;
          }
        });

        if (caseAssertions.length === 0) {
          caseAssertions.push({ type: 'contains', value: '' });
        }

        importedCases.push({
          id: 'tc_' + Math.random().toString(36).substr(2, 9) + '_' + i,
          name: caseName,
          variables: caseVars,
          assertions: caseAssertions
        });
      }

      setTestCaseStates([...testCases, ...importedCases]);
      alert(`Successfully imported ${importedCases.length} test cases from CSV!`);
    } catch (e: any) {
      alert(`Failed to parse CSV dataset: ${e.message}`);
    }
  };

  const handleRunEvaluation = async () => {
    if (!currentPrompt) return;
    
    const ver = currentPrompt.versions.find(v => v.version === selectedVersion);
    if (!ver) return;

    setRunning(true);
    setRunResults(null);

    try {
      const res = await api.post('/api/evaluate/run', {
        model: selectedModel,
        systemInstruction: ver.systemInstruction,
        template: ver.template,
        parameters: ver.parameters,
        testCases
      });
      setRunResults(res);

      // Save execution runs summary in historical runs db
      await api.post('/api/runs', {
        run: {
          projectName: projects.find(p => p.id === selectedProjectId)?.name || 'Evaluator',
          promptName: `${currentPrompt.name} (v${selectedVersion} Eval: ${res.successRate}% Pass)`,
          model: selectedModel,
          metrics: {
            durationMs: res.results.reduce((sum: number, r: any) => sum + (r.metrics?.durationMs || 0), 0) / res.results.length,
            tokenUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0
            }
          },
          passed: res.successRate === 100
        }
      });

    } catch (e: any) {
      alert(`Evaluation failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="eval-container fade-in">
      <div className="eval-header">
        <h1>Prompt Evaluator</h1>
        <p>Define verification test cases and run automated assertions (including LLM-as-a-judge rubrics) to check prompts.</p>
      </div>

      {/* Settings Bar */}
      <div className="eval-config-bar glass-panel">
        <div className="config-grid">
          <div className="config-item">
            <label>Project</label>
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">-- Select Project --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="config-item">
            <label>Prompt</label>
            <select value={selectedPromptId} onChange={(e) => setSelectedPromptId(e.target.value)} disabled={!selectedProjectId}>
              <option value="">-- Select Prompt --</option>
              {selectedProjectId && projects.find(p => p.id === selectedProjectId)?.prompts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="config-item">
            <label>Version</label>
            <select 
              value={selectedVersion} 
              onChange={(e) => setSelectedVersion(parseInt(e.target.value))}
              disabled={!currentPrompt}
            >
              {currentPrompt?.versions.map(v => (
                <option key={v.version} value={v.version}>v{v.version}</option>
              ))}
            </select>
          </div>

          <div className="config-item">
            <label>Evaluator LLM Model</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {models.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="config-actions">
          <button 
            className="btn btn-primary" 
            onClick={handleRunEvaluation} 
            disabled={running || testCases.length === 0 || !selectedPromptId}
          >
            <Play size={16} />
            {running ? 'Running Suite...' : 'Run Evaluation Suite'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleSaveSuite}
            disabled={savingSuite || !selectedPromptId}
          >
            <Save size={16} />
            Save Test Suite
          </button>
        </div>
      </div>

      {/* Results summary panel */}
      {runResults && (
        <div className="eval-summary-panel glass-panel-glow">
          <div className="summary-details">
            <div className="summary-metric">
              <span className="metric-score">{runResults.successRate}%</span>
              <span className="metric-lbl">Pass Rate</span>
            </div>
            <div className="summary-metric">
              <span className="metric-score">{runResults.passedCount}/{runResults.totalCount}</span>
              <span className="metric-lbl">Cases Passed</span>
            </div>
            <div className="summary-metric">
              <span className="metric-score">{runResults.passedAssertions}/{runResults.totalAssertions}</span>
              <span className="metric-lbl">Assertions Passed</span>
            </div>
          </div>
          <div className="summary-status">
            {runResults.successRate === 100 ? (
              <div className="success-banner-eval">
                <CheckCircle2 size={24} className="green" />
                <div>
                  <h4>All Tests Passed!</h4>
                  <p>The prompt version met all defined assertions and semantic expectations.</p>
                </div>
              </div>
            ) : (
              <div className="warning-banner-eval">
                <AlertTriangle size={24} className="yellow" />
                <div>
                  <h4>Regressions / Failures Detected</h4>
                  <p>Please inspect the failing assertions below to refine your prompt templates.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test Cases Builder Layout */}
      {selectedPromptId ? (
        <div className="eval-workspace">
          <div className="suite-header-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Test Suite Structure ({testCases.length} Cases)</h3>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {runResults && (
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
              <button 
                className="btn btn-secondary" 
                onClick={() => document.getElementById('dataset-import-input')?.click()}
                disabled={!selectedPromptId}
              >
                Import Dataset (CSV/JSON)
              </button>
              <input 
                type="file"
                id="dataset-import-input"
                accept=".csv,.json"
                onChange={handleImportFileChange}
                style={{ display: 'none' }}
              />
              <button className="btn btn-secondary" onClick={addTestCase}>
                <PlusCircle size={16} />
                Add Test Case
              </button>
            </div>
          </div>

          <div className="test-cases-list">
            {testCases.map((tc) => {
              const matchedResult = runResults?.results.find((r: any) => r.id === tc.id);
              return (
                <div key={tc.id} className={`test-case-card glass-panel ${matchedResult ? (matchedResult.passed ? 'border-success' : 'border-error') : ''}`}>
                  <div className="tc-card-header">
                    <input
                      type="text"
                      className="tc-name-input"
                      value={tc.name}
                      onChange={(e) => updateTestCaseName(tc.id, e.target.value)}
                    />
                    
                    {testCases.length > 1 && (
                      <button className="tc-delete-btn" onClick={() => removeTestCase(tc.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <div className="tc-card-body">
                    {/* Variables Block */}
                    {variables.length > 0 && (
                      <div className="tc-variables-section">
                        <h5>Variables</h5>
                        <div className="tc-variables-inputs">
                          {variables.map(v => (
                            <div key={v} className="tc-var-input-row">
                              <span className="tc-var-label">{v}</span>
                              <input
                                type="text"
                                placeholder={`Value for {{${v}}}`}
                                value={tc.variables[v] || ''}
                                onChange={(e) => updateTestCaseVariable(tc.id, v, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assertions Block */}
                    <div className="tc-assertions-section">
                      <div className="assertions-header">
                        <h5>Validation Assertions</h5>
                        <button className="icon-btn-mini" onClick={() => addAssertion(tc.id)}>
                          <Plus size={14} /> Add Assertion
                        </button>
                      </div>
                      
                      <div className="assertions-list">
                        {tc.assertions.map((ast, idx) => (
                          <div key={idx} className="assertion-row">
                            <select
                              value={ast.type}
                              onChange={(e) => updateAssertion(tc.id, idx, { type: e.target.value as any })}
                            >
                              <option value="contains">Contains (Case-Insensitive)</option>
                              <option value="not_contains">Does Not Contain</option>
                              <option value="regex">Matches Regex</option>
                              <option value="llm_judge">LLM-as-a-judge Rubric</option>
                            </select>

                            <input
                              type="text"
                              placeholder={
                                ast.type === 'llm_judge'
                                  ? 'Enter judging criteria, e.g. "Response should be in bullet points..."'
                                  : 'Expected text/pattern...'
                              }
                              value={ast.value}
                              onChange={(e) => updateAssertion(tc.id, idx, { value: e.target.value })}
                            />

                            {tc.assertions.length > 1 && (
                              <button className="assertion-delete" onClick={() => removeAssertion(tc.id, idx)}>
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Run Results Output */}
                    {matchedResult && (
                      <div className="tc-results-section">
                        <h5>Execution Report</h5>
                        
                        <div className="assertion-statuses">
                          {matchedResult.assertions.map((res: any, idx: number) => (
                            <div key={idx} className={`assertion-status-badge ${res.passed ? 'pass' : 'fail'}`}>
                              {res.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                              <span>
                                <b>[{res.type}]</b>: {res.details}
                              </span>
                            </div>
                          ))}
                        </div>

                        {matchedResult.output && (
                          <div className="tc-result-output">
                            <span className="output-header">Output:</span>
                            {outputViewMode === 'raw' ? (
                              <pre className="output-content">{matchedResult.output}</pre>
                            ) : (
                              <div className="output-content-markdown" style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '6px' }}>
                                <MarkdownRenderer content={matchedResult.output} />
                              </div>
                            )}
                          </div>
                        )}
                        
                        {matchedResult.metrics && (
                          <div className="tc-metrics" style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                            <span>Latency: <b>{matchedResult.metrics.durationMs}ms</b></span>
                            {matchedResult.metrics.tokenUsage && (
                              <span>Tokens: <b>{matchedResult.metrics.tokenUsage.totalTokens}</b> ({matchedResult.metrics.tokenUsage.inputTokens}i / {matchedResult.metrics.tokenUsage.outputTokens}o)</span>
                            )}
                            {matchedResult.metrics.costEstimate !== undefined && (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>Cost: ${matchedResult.metrics.costEstimate.toFixed(5)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="eval-empty-state">
          <Layers size={48} className="empty-icon" />
          <h3>Select a Prompt to Configure Evaluations</h3>
          <p>Choose an active project and prompt to construct and run assertion test suites.</p>
        </div>
      )}
    </div>
  );
};
export default Evaluator;
