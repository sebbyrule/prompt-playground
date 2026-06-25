import React, { useState, useEffect, useRef } from 'react';
import './PromptStudio.css';
import api from '../utils/api';
import {
  FolderPlus, 
  FilePlus, 
  Trash2, 
  Folder, 
  FileText, 
  Save, 
  Play, 
  History, 
  Upload, 
  AlertCircle,
  Layers,
  Copy,
  PlusCircle,
  HelpCircle,
  GitBranch,
  GitMerge,
  X,
  Code2,
  SendHorizontal,
  Check,
  Sparkles
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ParameterSet {
  temperature: number;
  maxTokens: number;
}

interface PromptVersion {
  version: number;
  systemInstruction: string;
  template: string;
  variables: string[];
  parameters: ParameterSet;
  createdAt: string;
  description: string;
}

interface FewShotExample {
  id: string;
  input: string;
  output: string;
  description: string;
  createdAt: string;
}

// Branch version stored within a branch object
interface BranchVersion {
  version: number;
  systemInstruction: string;
  template: string;
  variables: string[];
  parameters: ParameterSet;
  createdAt: string;
  description: string;
}

// Branch object attached to a prompt for experimental prompt development
interface Branch {
  name: string;
  baseVersion: number;
  createdAt: string;
  versions: BranchVersion[];
}

interface Prompt {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  versions: PromptVersion[];
  fewShotExamples?: FewShotExample[];
  branches?: Branch[];
}

interface GraphNode {
  id: string;
  version: number;
  branchName: string;
  description: string;
  createdAt: string;
  track: number;
  isBranchStart?: boolean;
  baseVersion?: number;
  rawObject: any;
}

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  prompts: Prompt[];
}

export const PromptStudio: React.FC = () => {
  // DB States
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activePrompt, setActivePrompt] = useState<Prompt | null>(null);
  
  // Editor States (Modified content)
  const [promptName, setPromptName] = useState('');
  const [promptDesc, setPromptDesc] = useState('');
  const [systemInstruction, setSystemInstruction] = useState('');
  const [template, setTemplate] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [versionDescription, setVersionDescription] = useState('');
  
  // Creation States
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjInput, setShowNewProjInput] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [showNewPromptInput, setShowNewPromptInput] = useState(false);

  // Runner States
  const [runnerVariables, setRunnerVariables] = useState<{ [key: string]: string }>({});
  const [imageFiles, setImageFiles] = useState<{ base64: string; mimeType: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState('');
  const [runMetrics, setRunMetrics] = useState<any>(null);
  const [runError, setRunError] = useState('');

  // Chat Simulator States
  const [chatSimMode, setChatSimMode] = useState(false);
  const [chatHistory, setChatHistory] = useState<{role: string; content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatThreadRef = useRef<HTMLDivElement>(null);

  // Right drawer states
  const [drawerTab, setDrawerTab] = useState<'run' | 'history' | 'few-shot' | 'code'>('run');
  const [outputViewMode, setOutputViewMode] = useState<'raw' | 'preview'>('raw');
  
  // Few-Shot form states
  const [fewShotsEnabled, setFewShotsEnabled] = useState(true);
  const [newFewShotInput, setNewFewShotInput] = useState('');
  const [newFewShotOutput, setNewFewShotOutput] = useState('');
  const [newFewShotDesc, setNewFewShotDesc] = useState('');
  const [showFewShotForm, setShowFewShotForm] = useState(false);
  const [compareVersion, setCompareVersion] = useState<PromptVersion | null>(null);
  
  // Git History states
  const [gitHistoryTab, setGitHistoryTab] = useState<'local' | 'git'>('local');
  const [gitHistory, setGitHistory] = useState<any[]>([]);
  const [gitEnabled, setGitEnabled] = useState(false);
  const [loadingGit, setLoadingGit] = useState(false);
  const [compareGitCommit, setCompareGitCommit] = useState<any | null>(null);
  const [snippetLang, setSnippetLang] = useState<'python' | 'js'>('python');
  const [snippetSdk, setSnippetSdk] = useState<'gemini' | 'claude' | 'openai'>('gemini');

  // Branch States
  const [activeBranch, setActiveBranch] = useState<string>('main');
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeMessage, setMergeMessage] = useState('');

  // Payload Inspector States
  const [rawPayload, setRawPayload] = useState<{ rawRequest: any; rawResponse: any } | null>(null);
  const [payloadTab, setPayloadTab] = useState<'request' | 'response'>('request');
  const [showPayloadModal, setShowPayloadModal] = useState(false);
  const [payloadCopied, setPayloadCopied] = useState(false);

  // Critique States
  const [showCritiquePanel, setShowCritiquePanel] = useState(false);
  const [critiqueData, setCritiqueData] = useState<any>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [critiqueError, setCritiqueError] = useState('');

  // General States
  const [isSaved, setIsSaved] = useState(true);
  const [loading, setLoading] = useState(true);

  // Predefined models list
  const [localModels, setLocalModels] = useState<{ value: string; label: string }[]>([]);

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

  const buildVersionGraph = (prompt: Prompt) => {
    const nodes: GraphNode[] = [];
    const tracks: string[] = ['main'];

    // Add main versions
    (prompt.versions || []).forEach(v => {
      nodes.push({
        id: `main-${v.version}`,
        version: v.version,
        branchName: 'main',
        description: v.description,
        createdAt: v.createdAt,
        track: 0,
        rawObject: v
      });
    });

    // Add branch versions
    (prompt.branches || []).forEach((branch) => {
      const trackIdx = tracks.length;
      tracks.push(branch.name);

      branch.versions.forEach((bv, vIdx) => {
        nodes.push({
          id: `${branch.name}-${bv.version}`,
          version: bv.version,
          branchName: branch.name,
          description: bv.description,
          createdAt: bv.createdAt,
          track: trackIdx,
          isBranchStart: vIdx === 0,
          baseVersion: branch.baseVersion,
          rawObject: bv
        });
      });
    });

    // Sort nodes descending (latest first)
    nodes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { nodes, tracks };
  };

  useEffect(() => {
    loadProjects();
    fetchLocalModels();
  }, []);

  useEffect(() => {
    const applied = localStorage.getItem('copilot_applied_prompt');
    if (applied) {
      try {
        const data = JSON.parse(applied);
        if (data.systemInstruction !== undefined) {
          setSystemInstruction(data.systemInstruction);
        }
        if (data.template !== undefined) {
          setTemplate(data.template);
        }
        setIsSaved(false);
        localStorage.removeItem('copilot_applied_prompt');
      } catch (e) {
        console.error('Failed to apply Copilot prompt to studio:', e);
      }
    }
  }, [activePrompt]);

  async function fetchLocalModels() {
    try {
      const res = await api.get('/api/local-models');
      if (res.models && Array.isArray(res.models)) {
        setLocalModels(res.models);
      }
    } catch (err) {
      console.error('Failed to load local models in PromptStudio:', err);
    }
  }

  async function loadProjects() {
    try {
      const projs = await api.get('/api/projects');
      setProjects(projs);
      
      // Auto-select first prompt if available
      if (projs.length > 0 && !activeProject) {
        setActiveProject(projs[0]);
        if (projs[0].prompts?.length > 0) {
          selectPrompt(projs[0].prompts[0], projs[0]);
        }
      }
    } catch (e) {
      console.error('Error loading projects:', e);
    } finally {
      setLoading(false);
    }
  }

  const selectPrompt = (prompt: Prompt, project: Project) => {
    setActiveProject(project);
    setActivePrompt(prompt);
    
    // Set Editor states to the latest version
    const latestVersion = prompt.versions[prompt.versions.length - 1];
    setPromptName(prompt.name);
    setPromptDesc(prompt.description);
    setSystemInstruction(latestVersion.systemInstruction);
    setTemplate(latestVersion.template);
    setTemperature(latestVersion.parameters.temperature);
    setMaxTokens(latestVersion.parameters.maxTokens);
    setVersionDescription('');
    setCompareVersion(null);
    setCompareGitCommit(null);
    setGitHistoryTab('local');
    setDrawerTab('run');
    setIsSaved(true);
    
    // Reset branch states
    setActiveBranch('main');
    setShowBranchModal(false);
    setShowMergeModal(false);
    
    // Reset chat simulator
    setChatSimMode(false);
    setChatHistory([]);
    setChatInput('');
    
    // Set up test runner variables
    const vars: { [key: string]: string } = {};
    latestVersion.variables.forEach(v => {
      vars[v] = '';
    });
    setRunnerVariables(vars);
    setImageFiles([]);
    setRunOutput('');
    setRunMetrics(null);
    setRunError('');
  };

  const applyVersion = (ver: PromptVersion) => {
    setSystemInstruction(ver.systemInstruction);
    setTemplate(ver.template);
    setTemperature(ver.parameters.temperature);
    setMaxTokens(ver.parameters.maxTokens);
    setIsSaved(false);
    setDrawerTab('run');
  };

  const loadGitHistory = async (promptId: string) => {
    setLoadingGit(true);
    setCompareGitCommit(null);
    try {
      const res = await api.get(`/api/prompts/${promptId}/git-history`);
      setGitEnabled(res.gitEnabled);
      setGitHistory(res.history || []);
    } catch (e) {
      console.error('Error loading git history:', e);
      setGitHistory([]);
      setGitEnabled(false);
    } finally {
      setLoadingGit(false);
    }
  };

  const applyGitCommit = (commit: any) => {
    setSystemInstruction(commit.systemInstruction);
    setTemplate(commit.template);
    setIsSaved(false);
    setDrawerTab('run');
  };

  const handleSelectGitHistoryTab = (tab: 'local' | 'git') => {
    setGitHistoryTab(tab);
    if (tab === 'git' && activePrompt) {
      loadGitHistory(activePrompt.id);
    }
  };

  // Detect variables dynamically from template
  const detectedVariables = React.useMemo(() => {
    const vars: string[] = [];
    const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
    let match;
    while ((match = regex.exec(template)) !== null) {
      if (!vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
    return vars;
  }, [template]);

  // Sync variables for runner when variables are detected
  useEffect(() => {
    const newVars: { [key: string]: string } = {};
    detectedVariables.forEach(v => {
      newVars[v] = runnerVariables[v] || '';
    });
    setRunnerVariables(newVars);
  }, [detectedVariables]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const newProj = await api.post('/api/projects', { name: newProjectName.trim() });
      setProjects([...projects, newProj]);
      setActiveProject(newProj);
      setNewProjectName('');
      setShowNewProjInput(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPromptName.trim() || !activeProject) return;

    try {
      const prompt = await api.post(`/api/projects/${activeProject.id}/prompts`, {
        name: newPromptName.trim(),
        template: 'Hello {{name}}, welcome to PromptForge!',
        parameters: { temperature: 0.7, maxTokens: 1024 }
      });
      
      // Update local state
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return { ...p, prompts: [...p.prompts, prompt] };
        }
        return p;
      });
      setProjects(updatedProjects);
      
      const refreshedProj = updatedProjects.find(p => p.id === activeProject.id)!;
      selectPrompt(prompt, refreshedProj);
      
      setNewPromptName('');
      setShowNewPromptInput(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeletePrompt = async (promptId: string, projectId: string) => {
    if (!window.confirm('Are you sure you want to delete this prompt?')) return;
    try {
      await api.delete(`/api/projects/${projectId}/prompts/${promptId}`);
      
      const updatedProjects = projects.map(p => {
        if (p.id === projectId) {
          return { ...p, prompts: p.prompts.filter(pr => pr.id !== promptId) };
        }
        return p;
      });
      setProjects(updatedProjects);
      
      if (activePrompt?.id === promptId) {
        setActivePrompt(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this project? All prompts inside it will be permanently deleted.')) return;
    try {
      await api.delete(`/api/projects/${projectId}`);
      const updatedProjects = projects.filter(p => p.id !== projectId);
      setProjects(updatedProjects);
      
      if (activeProject?.id === projectId) {
        setActiveProject(null);
        setActivePrompt(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunCritique = async () => {
    if (!activePrompt) return;
    setCritiqueLoading(true);
    setCritiqueError('');
    setCritiqueData(null);
    try {
      const res = await api.post('/api/copilot/critique', {
        systemInstruction,
        template,
        model: selectedModel
      });
      setCritiqueData(res);
    } catch (err: any) {
      console.error(err);
      setCritiqueError(err.message || 'Failed to generate prompt critique.');
    } finally {
      setCritiqueLoading(false);
    }
  };

  const applyCritiqueOptimizations = () => {
    if (!critiqueData) return;
    if (!window.confirm('Apply AI optimizations? This will overwrite your current System Instructions and Prompt Template.')) return;
    
    if (critiqueData.optimizedSystemInstruction !== undefined) {
      setSystemInstruction(critiqueData.optimizedSystemInstruction);
    }
    if (critiqueData.optimizedTemplate !== undefined) {
      setTemplate(critiqueData.optimizedTemplate);
    }
    setIsSaved(false);
    setShowCritiquePanel(false);
  };

  const handleSavePromptVersion = async () => {
    if (!activeProject || !activePrompt) return;

    try {
      const desc = versionDescription.trim() || `Saved on ${new Date().toLocaleDateString()}`;
      const newVersion = await api.post(`/api/projects/${activeProject.id}/prompts/${activePrompt.id}/versions`, {
        systemInstruction,
        template,
        parameters: { temperature, maxTokens },
        description: desc
      });

      // Update state with new version
      const updatedPrompt = {
        ...activePrompt,
        versions: [...activePrompt.versions, newVersion]
      };
      
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr)
          };
        }
        return p;
      });
      
      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);
      setVersionDescription('');
      setIsSaved(true);
      
      // Flash save notification
      alert('Prompt version saved successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to save version.');
    }
  };

  const handleAddFewShot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !activePrompt || !newFewShotInput.trim() || !newFewShotOutput.trim()) return;

    try {
      const newEx = await api.post(`/api/projects/${activeProject.id}/prompts/${activePrompt.id}/few-shot`, {
        input: newFewShotInput.trim(),
        output: newFewShotOutput.trim(),
        description: newFewShotDesc.trim()
      });

      const updatedPrompt = {
        ...activePrompt,
        fewShotExamples: [...(activePrompt.fewShotExamples || []), newEx]
      };
      
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr)
          };
        }
        return p;
      });

      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);

      setNewFewShotInput('');
      setNewFewShotOutput('');
      setNewFewShotDesc('');
      setShowFewShotForm(false);
    } catch (err) {
      console.error(err);
      alert('Failed to add few-shot example.');
    }
  };

  const handleDeleteFewShot = async (exId: string) => {
    if (!activeProject || !activePrompt || !window.confirm('Delete this few-shot example?')) return;

    try {
      await api.delete(`/api/projects/${activeProject.id}/prompts/${activePrompt.id}/few-shot/${exId}`);

      const updatedPrompt = {
        ...activePrompt,
        fewShotExamples: (activePrompt.fewShotExamples || []).filter(ex => ex.id !== exId)
      };

      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr)
          };
        }
        return p;
      });

      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);
    } catch (err) {
      console.error(err);
      alert('Failed to delete few-shot example.');
    }
  };

  // ─── Branch Management Functions ──────────────────────────────────────────

  /** Create a new branch from the current editor version */
  const handleCreateBranch = async () => {
    if (!activeProject || !activePrompt || !newBranchName.trim()) return;
    try {
      const currentVersion = activePrompt.versions.length;
      const branch = await api.post(
        `/api/projects/${activeProject.id}/prompts/${activePrompt.id}/branches`,
        { name: newBranchName.trim(), baseVersion: currentVersion }
      );
      // Update local state with new branch
      const updatedPrompt = {
        ...activePrompt,
        branches: [...(activePrompt.branches || []), branch]
      };
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return { ...p, prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr) };
        }
        return p;
      });
      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);
      setActiveBranch(newBranchName.trim());
      setNewBranchName('');
      setShowBranchModal(false);
    } catch (err) {
      console.error(err);
      alert('Failed to create branch.');
    }
  };

  /** Switch the editor content to a different branch (or back to main) */
  const handleSwitchBranch = (branchName: string) => {
    if (!activePrompt) return;
    setActiveBranch(branchName);

    if (branchName === 'main') {
      // Load latest main version
      const latest = activePrompt.versions[activePrompt.versions.length - 1];
      setSystemInstruction(latest.systemInstruction);
      setTemplate(latest.template);
      setTemperature(latest.parameters.temperature);
      setMaxTokens(latest.parameters.maxTokens);
    } else {
      // Load latest branch version
      const branch = (activePrompt.branches || []).find(b => b.name === branchName);
      if (branch && branch.versions.length > 0) {
        const latest = branch.versions[branch.versions.length - 1];
        setSystemInstruction(latest.systemInstruction);
        setTemplate(latest.template);
        setTemperature(latest.parameters.temperature);
        setMaxTokens(latest.parameters.maxTokens);
      }
    }
    setIsSaved(true);
  };

  /** Save a new version on the active branch */
  const handleSaveBranchVersion = async () => {
    if (!activeProject || !activePrompt || activeBranch === 'main') return;
    try {
      const desc = versionDescription.trim() || `Branch update on ${new Date().toLocaleDateString()}`;
      const newVer = await api.post(
        `/api/projects/${activeProject.id}/prompts/${activePrompt.id}/branches/${activeBranch}/versions`,
        { systemInstruction, template, parameters: { temperature, maxTokens }, description: desc }
      );
      // Update local state
      const updatedBranches = (activePrompt.branches || []).map(b => {
        if (b.name === activeBranch) {
          return { ...b, versions: [...b.versions, newVer] };
        }
        return b;
      });
      const updatedPrompt = { ...activePrompt, branches: updatedBranches };
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return { ...p, prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr) };
        }
        return p;
      });
      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);
      setVersionDescription('');
      setIsSaved(true);
      alert('Branch version saved!');
    } catch (err) {
      console.error(err);
      alert('Failed to save branch version.');
    }
  };

  /** Merge the active branch into main and delete it */
  const handleMergeBranch = async () => {
    if (!activeProject || !activePrompt || activeBranch === 'main') return;
    try {
      const msg = mergeMessage.trim() || `Merged branch ${activeBranch}`;
      await api.post(
        `/api/projects/${activeProject.id}/prompts/${activePrompt.id}/branches/${activeBranch}/merge`,
        { mergeMessage: msg }
      );
      // Refresh projects to get updated versions and removed branch
      await loadProjects();
      setActiveBranch('main');
      setMergeMessage('');
      setShowMergeModal(false);
      alert(`Branch "${activeBranch}" merged successfully!`);
    } catch (err) {
      console.error(err);
      alert('Failed to merge branch.');
    }
  };

  /** Delete the active branch */
  const handleDeleteBranch = async () => {
    if (!activeProject || !activePrompt || activeBranch === 'main') return;
    if (!window.confirm(`Delete branch "${activeBranch}"? This cannot be undone.`)) return;
    try {
      await api.delete(
        `/api/projects/${activeProject.id}/prompts/${activePrompt.id}/branches/${activeBranch}`
      );
      const updatedPrompt = {
        ...activePrompt,
        branches: (activePrompt.branches || []).filter(b => b.name !== activeBranch)
      };
      const updatedProjects = projects.map(p => {
        if (p.id === activeProject.id) {
          return { ...p, prompts: p.prompts.map(pr => pr.id === activePrompt.id ? updatedPrompt : pr) };
        }
        return p;
      });
      setProjects(updatedProjects);
      setActivePrompt(updatedPrompt);
      setActiveBranch('main');
      // Reload main version
      const latest = updatedPrompt.versions[updatedPrompt.versions.length - 1];
      setSystemInstruction(latest.systemInstruction);
      setTemplate(latest.template);
    } catch (err) {
      console.error(err);
      alert('Failed to delete branch.');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageFiles(prev => [
          ...prev, 
          { 
            base64: reader.result as string, 
            mimeType: file.type 
          }
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRunTest = async () => {
    if (!template) return;
    
    setRunning(true);
    setRunOutput('');
    setRunMetrics(null);
    setRunError('');
    setRawPayload(null);

    try {
      // Resolve prompt template
      let resolvedPrompt = template;
      for (const [key, val] of Object.entries(runnerVariables)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        resolvedPrompt = resolvedPrompt.replace(regex, val);
      }

      // Append few shots if enabled
      let systemWithFewShots = systemInstruction;
      if (fewShotsEnabled && activePrompt?.fewShotExamples && activePrompt.fewShotExamples.length > 0) {
        const examplesText = activePrompt.fewShotExamples.map((ex, i) => 
          `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`
        ).join('\n\n');
        systemWithFewShots += `\n\nUse the following few-shot examples for context:\n${examplesText}`;
      }

      const res = await api.post('/api/run', {
        model: selectedModel,
        systemInstruction: systemWithFewShots,
        prompt: resolvedPrompt,
        temperature,
        maxTokens,
        images: imageFiles
      });

      setRunOutput(res.output);
      setRunMetrics(res.metrics);
      setRawPayload({ rawRequest: res.rawRequest, rawResponse: res.rawResponse });

      // Save to global runs database
      await api.post('/api/runs', {
        run: {
          projectName: activeProject?.name || 'Playground',
          promptName: activePrompt?.name || 'Ad-hoc',
          model: selectedModel,
          metrics: res.metrics
        }
      });
    } catch (e: any) {
      setRunError(e.message || 'Run failed. Please check your settings and backend server.');
    } finally {
      setRunning(false);
    }
  };

  // Auto-scroll chat thread when new messages arrive
  useEffect(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, [chatHistory, chatLoading]);

  const buildSystemWithFewShots = () => {
    let systemWithFewShots = systemInstruction;
    if (fewShotsEnabled && activePrompt?.fewShotExamples && activePrompt.fewShotExamples.length > 0) {
      const examplesText = activePrompt.fewShotExamples.map((ex, i) => 
        `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`
      ).join('\n\n');
      systemWithFewShots += `\n\nUse the following few-shot examples for context:\n${examplesText}`;
    }
    return systemWithFewShots;
  };

  const handleStartChat = async () => {
    if (!template) return;

    // Resolve prompt template (same logic as handleRunTest)
    let resolvedPrompt = template;
    for (const [key, val] of Object.entries(runnerVariables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      resolvedPrompt = resolvedPrompt.replace(regex, val);
    }

    const userMsg = { role: 'user', content: resolvedPrompt };
    setChatHistory([userMsg]);
    setChatLoading(true);

    try {
      const res = await api.post('/api/agent/run', {
        model: selectedModel,
        systemInstruction: buildSystemWithFewShots(),
        prompt: resolvedPrompt,
        history: [],
        tools: [],
        autoExecuteMocks: false
      });

      setChatHistory(prev => [...prev, { role: 'assistant', content: res.finalOutput }]);
    } catch (e: any) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${e.message || 'Request failed'}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendChatMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;

    const userMsg = { role: 'user', content: msg };
    const updatedHistory = [...chatHistory, userMsg];
    setChatHistory(updatedHistory);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await api.post('/api/agent/run', {
        model: selectedModel,
        systemInstruction: buildSystemWithFewShots(),
        prompt: msg,
        history: chatHistory,
        tools: [],
        autoExecuteMocks: false
      });

      setChatHistory(prev => [...prev, { role: 'assistant', content: res.finalOutput }]);
    } catch (e: any) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${e.message || 'Request failed'}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleClearChat = () => {
    setChatHistory([]);
    setChatInput('');
  };

  const getCodeSnippet = (lang: 'python' | 'js', sdk: 'gemini' | 'claude' | 'openai') => {
    if (lang === 'python') {
      if (sdk === 'gemini') {
        return `import google.genai as genai
from google.genai import types

client = genai.Client()

# Resolving prompt variables
variables = {
${detectedVariables.map(v => `    "${v}": "your_value_here"`).join(',\n')}
}
prompt_text = """${template}"""
for key, val in variables.items():
    prompt_text = prompt_text.replace(f"{{{{{key}}}}}", val)

response = client.models.generate_content(
    model="${selectedModel}",
    contents=prompt_text,
    config=types.GenerateContentConfig(
        system_instruction="""${systemInstruction}""",
        temperature=${temperature},
        max_output_tokens=${maxTokens}
    )
)
print(response.text)`;
      } else if (sdk === 'claude') {
        return `from anthropic import Anthropic

client = Anthropic()

# Resolving prompt variables
variables = {
${detectedVariables.map(v => `    "${v}": "your_value_here"`).join(',\n')}
}
prompt_text = """${template}"""
for key, val in variables.items():
    prompt_text = prompt_text.replace(f"{{{{{key}}}}}", val)

message = client.messages.create(
    model="${selectedModel.includes('claude') ? selectedModel : 'claude-3-5-sonnet-20241022'}",
    max_tokens=${maxTokens},
    temperature=${temperature},
    system="""${systemInstruction}""",
    messages=[
        {"role": "user", "content": prompt_text}
    ]
)
print(message.content[0].text)`;
      } else {
        return `from openai import OpenAI

client = OpenAI()

# Resolving prompt variables
variables = {
${detectedVariables.map(v => `    "${v}": "your_value_here"`).join(',\n')}
}
prompt_text = """${template}"""
for key, val in variables.items():
    prompt_text = prompt_text.replace(f"{{{{{key}}}}}", val)

response = client.chat.completions.create(
    model="${selectedModel.includes('gpt') ? selectedModel : 'gpt-4o'}",
    messages=[
        {"role": "system", "content": """${systemInstruction}"""},
        {"role": "user", "content": prompt_text}
    ],
    temperature=${temperature},
    max_tokens=${maxTokens}
)
print(response.choices[0].message.content)`;
      }
    } else {
      // JavaScript
      if (sdk === 'gemini') {
        return `import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const variables = {
${detectedVariables.map(v => `  ${v}: "your_value_here"`).join(',\n')}
};

let promptText = \`${template}\`;
for (const [key, val] of Object.entries(variables)) {
  promptText = promptText.replace(new RegExp(\`{{ \?\${key} \?}}\`, 'g'), val);
}

const model = genAI.getGenerativeModel({ 
  model: "${selectedModel}",
  systemInstruction: \`${systemInstruction}\`
});

async function run() {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: ${temperature},
      maxOutputTokens: ${maxTokens}
    }
  });
  console.log(result.response.text());
}
run();`;
      } else if (sdk === 'claude') {
        return `import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const variables = {
${detectedVariables.map(v => `  ${v}: "your_value_here"`).join(',\n')}
};

let promptText = \`${template}\`;
for (const [key, val] of Object.entries(variables)) {
  promptText = promptText.replace(new RegExp(\`{{ \?\${key} \?}}\`, 'g'), val);
}

async function run() {
  const msg = await anthropic.messages.create({
    model: "${selectedModel.includes('claude') ? selectedModel : 'claude-3-5-sonnet-20241022'}",
    max_tokens: ${maxTokens},
    temperature: ${temperature},
    system: \`${systemInstruction}\`,
    messages: [{ role: "user", content: promptText }],
  });
  console.log(msg.content[0].text);
}
run();`;
      } else {
        return `import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const variables = {
${detectedVariables.map(v => `  ${v}: "your_value_here"`).join(',\n')}
};

let promptText = \`${template}\`;
for (const [key, val] of Object.entries(variables)) {
  promptText = promptText.replace(new RegExp(\`{{ \?\${key} \?}}\`, 'g'), val);
}

async function run() {
  const response = await openai.chat.completions.create({
    model: "${selectedModel.includes('gpt') ? selectedModel : 'gpt-4o'}",
    messages: [
      { role: "system", content: \`${systemInstruction}\` },
      { role: "user", content: promptText }
    ],
    temperature: ${temperature},
    max_tokens: ${maxTokens},
  });
  console.log(response.choices[0].message.content);
}
run();`;
      }
    }
  };

  const isVisionCapable = selectedModel.startsWith('gemini') || selectedModel.startsWith('claude') || selectedModel.startsWith('gpt');

  if (loading) {
    return <div className="studio-loading">Loading Prompt Studio...</div>;
  }

  return (
    <div className="studio-layout fade-in">
      {/* 1. Left Side: Projects & Prompts browser */}
      <div className="studio-browser glass-panel-right">
        <div className="browser-header">
          <h3>Projects & Prompts</h3>
          <button className="icon-btn" title="New Project" onClick={() => setShowNewProjInput(!showNewProjInput)}>
            <FolderPlus size={16} />
          </button>
        </div>

        {showNewProjInput && (
          <form onSubmit={handleCreateProject} className="browser-input-form">
            <input
              type="text"
              placeholder="Project Name..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
            />
            <div className="form-actions-mini">
              <button type="submit" className="btn-primary-mini">Create</button>
              <button type="button" className="btn-secondary-mini" onClick={() => setShowNewProjInput(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="browser-tree">
          {projects.map(project => (
            <div key={project.id} className="project-node">
              <div 
                className={`project-node-header ${activeProject?.id === project.id ? 'active' : ''}`}
                onClick={() => setActiveProject(project)}
              >
                <Folder size={16} className="folder-icon" />
                <span>{project.name}</span>
                <div className="node-actions" onClick={(e) => e.stopPropagation()}>
                  <button 
                    className="node-add-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveProject(project);
                      setShowNewPromptInput(true);
                    }}
                    title="Add Prompt"
                  >
                    <FilePlus size={13} />
                  </button>
                  <button 
                    className="node-project-delete-btn" 
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    title="Delete Project"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="prompt-children">
                {activeProject?.id === project.id && showNewPromptInput && (
                  <form onSubmit={handleCreatePrompt} className="browser-input-form prompt-input">
                    <input
                      type="text"
                      placeholder="Prompt Name..."
                      value={newPromptName}
                      onChange={(e) => setNewPromptName(e.target.value)}
                      autoFocus
                    />
                    <div className="form-actions-mini">
                      <button type="submit" className="btn-primary-mini">Add</button>
                      <button type="button" className="btn-secondary-mini" onClick={() => setShowNewPromptInput(false)}>Cancel</button>
                    </div>
                  </form>
                )}

                {project.prompts?.map(prompt => (
                  <div 
                    key={prompt.id} 
                    className={`prompt-item ${activePrompt?.id === prompt.id ? 'selected' : ''}`}
                    onClick={() => selectPrompt(prompt, project)}
                  >
                    <FileText size={14} className="file-icon" />
                    <span className="prompt-item-name">{prompt.name}</span>
                    <span className="version-badge">v{prompt.versions?.length || 1}</span>
                    <button className="node-delete-btn" onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePrompt(prompt.id, project.id);
                    }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Main Editor pane */}
      {activePrompt ? (
        <div className="studio-editor">
          <div className="editor-top-bar">
            <div>
              <h2>{promptName}</h2>
              <span className="path-label">{activeProject?.name} / {activePrompt.name}</span>
              {promptDesc && <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{promptDesc}</p>}
            </div>
            
            <div className="editor-top-actions">
              {/* Branch Selector Dropdown */}
              <div className="branch-selector-container" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)', padding: '2px 8px', borderRadius: '8px' }}>
                <GitBranch size={14} style={{ color: activeBranch === 'main' ? 'var(--text-muted)' : 'var(--accent-primary)' }} />
                <select
                  className="branch-select-dropdown"
                  value={activeBranch}
                  onChange={(e) => handleSwitchBranch(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'white',
                    padding: '4px 20px 4px 4px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <option value="main" style={{ background: '#1e1e24' }}>main</option>
                  {(activePrompt.branches || []).map((b) => (
                    <option key={b.name} value={b.name} style={{ background: '#1e1e24' }}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <button
                  className="btn-icon-mini"
                  onClick={() => setShowBranchModal(true)}
                  title="Create new branch"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '4px' }}
                >
                  <PlusCircle size={14} />
                </button>

                {activeBranch !== 'main' && (
                  <>
                    <button
                      className="btn-icon-mini"
                      onClick={() => setShowMergeModal(true)}
                      title="Merge branch into main"
                      style={{ background: 'transparent', border: 'none', color: 'var(--success)', cursor: 'pointer', display: 'flex', padding: '4px' }}
                    >
                      <GitMerge size={14} />
                    </button>
                    <button
                      className="btn-icon-mini"
                      onClick={handleDeleteBranch}
                      title="Delete branch"
                      style={{ background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', display: 'flex', padding: '4px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>

              <button 
                className={`btn ${showCritiquePanel ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setShowCritiquePanel(!showCritiquePanel);
                  if (!showCritiquePanel && !critiqueData) {
                    setTimeout(handleRunCritique, 100);
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Sparkles size={16} />
                AI Critique & Optimize
              </button>

              <button 
                className="btn btn-secondary" 
                onClick={() => setDrawerTab(drawerTab === 'history' ? 'run' : 'history')}
                style={{ borderColor: drawerTab === 'history' ? 'var(--accent-primary)' : 'var(--border-color)', color: drawerTab === 'history' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                <History size={16} />
                History (v{activeBranch === 'main' ? activePrompt.versions.length : ((activePrompt.branches || []).find(b => b.name === activeBranch)?.versions.length || 0)})
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => activeBranch === 'main' ? handleSavePromptVersion() : handleSaveBranchVersion()}
              >
                <Save size={16} />
                Save Version {activeBranch !== 'main' && `(${activeBranch})`}
              </button>
            </div>
          </div>

          <div className="editor-content-split" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div className="editor-scrollable" style={{ flex: 1, overflowY: 'auto' }}>
            <div className="editor-grid">
              {/* System Instruction */}
              <div className="editor-card glass-panel">
                <div className="card-header">
                  <h4>System Instructions (System Prompt)</h4>
                </div>
                <textarea
                  className="editor-textarea system-input"
                  placeholder="You are a helpful, precise coding assistant..."
                  value={systemInstruction}
                  onChange={(e) => {
                    setSystemInstruction(e.target.value);
                    setIsSaved(false);
                  }}
                />
              </div>

              {/* Prompt Template */}
              <div className="editor-card glass-panel">
                <div className="card-header">
                  <h4>Prompt Template</h4>
                  <div className="variable-badges">
                    {detectedVariables.length > 0 ? (
                      detectedVariables.map(v => (
                        <span key={v} className="var-badge">
                          {`{{${v}}}`}
                        </span>
                      ))
                    ) : (
                      <span className="no-vars">No variables detected (use `{"{{variable}}"}`)</span>
                    )}
                  </div>
                </div>
                <textarea
                  className="editor-textarea template-input"
                  placeholder="Explain how {{topic}} works in {{language}}."
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    setIsSaved(false);
                  }}
                />
              </div>

              {/* Version details save box */}
              {!isSaved && (
                <div className="version-description-box glass-panel-glow">
                  <div className="alert-header">
                    <AlertCircle size={16} className="yellow" />
                    <span>Unsaved Changes Detected</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Describe what changed in this version..."
                    value={versionDescription}
                    onChange={(e) => setVersionDescription(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Visual Diffs comparing versions (if selected) */}
            {compareVersion && (
              <div className="compare-view glass-panel">
                <div className="compare-header">
                  <h4>Comparing Current Editor with Version {compareVersion.version}</h4>
                  <button className="btn-secondary-mini" onClick={() => setCompareVersion(null)}>Close Diff</button>
                </div>
                <div className="compare-body">
                  <div className="compare-column">
                    <h5>Current Editor</h5>
                    <pre className="compare-pre">{template}</pre>
                  </div>
                  <div className="compare-column">
                    <h5>Version {compareVersion.version} ({compareVersion.description})</h5>
                    <pre className="compare-pre">{compareVersion.template}</pre>
                  </div>
                </div>
              </div>
            )}

            {compareGitCommit && (
              <div className="compare-view glass-panel">
                <div className="compare-header">
                  <h4>Comparing Current Editor with Git Commit: {compareGitCommit.hash.substring(0, 7)}</h4>
                  <button className="btn-secondary-mini" onClick={() => setCompareGitCommit(null)}>Close Diff</button>
                </div>
                <div className="compare-body">
                  <div className="compare-column">
                    <h5>Current Editor</h5>
                    <pre className="compare-pre">{template}</pre>
                  </div>
                  <div className="compare-column">
                    <h5>Commit: "{compareGitCommit.message}"</h5>
                    <pre className="compare-pre">{compareGitCommit.template}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {showCritiquePanel && (
            <div className="critique-panel">
              <div className="critique-header">
                <h3>
                  <Sparkles size={16} className="sparkle-icon" style={{ color: 'var(--accent-primary)' }} />
                  AI Critique & Suggestions
                </h3>
                <button className="critique-close-btn" onClick={() => setShowCritiquePanel(false)}>
                  <X size={16} />
                </button>
              </div>

              <div className="critique-body">
                <button 
                  className="btn btn-primary" 
                  onClick={handleRunCritique} 
                  disabled={critiqueLoading}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {critiqueLoading ? 'Critiquing...' : 'Run Prompt Critique'}
                </button>

                {critiqueError && (
                  <div className="critique-error-box">
                    {critiqueError}
                  </div>
                )}

                {critiqueLoading && (
                  <div className="critique-loading-box">
                    <div className="critique-loading-spinner"></div>
                    <p>Analyzing prompt structure, clarity, and constraints...</p>
                  </div>
                )}

                {!critiqueLoading && !critiqueData && !critiqueError && (
                  <div className="critique-empty-box">
                    Click the button above to run an AI-powered critique of your prompt system instructions and template.
                  </div>
                )}

                {critiqueData && (
                  <div className="critique-results fade-in">
                    {/* Score circle */}
                    <div className="critique-score-card">
                      <div className="critique-score-ring">
                        {critiqueData.score}
                      </div>
                      <div className="critique-score-info">
                        <h4>Prompt Score</h4>
                        <p>Based on instructions structure</p>
                      </div>
                    </div>

                    {/* Critiques */}
                    <div>
                      <h4 className="critique-section-title">Analysis</h4>
                      
                      <div className="critique-analysis-list">
                        <div className="critique-analysis-item">
                          <span className="critique-analysis-label">🔍 Clarity</span>
                          <span className="critique-analysis-desc">{critiqueData.critique?.clarity}</span>
                        </div>
                        <div className="critique-analysis-item">
                          <span className="critique-analysis-label">🛡️ Constraints</span>
                          <span className="critique-analysis-desc">{critiqueData.critique?.constraints}</span>
                        </div>
                        <div className="critique-analysis-item">
                          <span className="critique-analysis-label">📝 Formatting</span>
                          <span className="critique-analysis-desc">{critiqueData.critique?.formatting}</span>
                        </div>
                      </div>
                    </div>

                    {/* Suggestions list */}
                    {critiqueData.suggestions && critiqueData.suggestions.length > 0 && (
                      <div>
                        <h4 className="critique-section-title">Recommendations</h4>
                        <ul className="critique-suggestions-list">
                          {critiqueData.suggestions.map((s: string, idx: number) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Apply button */}
                    <div className="critique-apply-section">
                      <button 
                        className="btn btn-primary" 
                        onClick={applyCritiqueOptimizations}
                        style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' }}
                      >
                        <Sparkles size={14} />
                        Apply AI Optimizations
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="editor-empty">
          <Layers size={48} className="empty-icon" />
          <h3>No Prompt Selected</h3>
          <p>Select a prompt from the sidebar, or create a new project and prompt to get started.</p>
        </div>
      )}

      {/* 3. Right Side: Runner drawer & History sidebar */}
      {activePrompt && (
        <div className="studio-drawer">
          {/* Tabs header */}
          <div className="drawer-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
            <button 
              className={`drawer-tab-btn ${drawerTab === 'run' ? 'active' : ''}`}
              onClick={() => setDrawerTab('run')}
              style={{ flex: 1, padding: '12px 6px', background: 'transparent', border: 'none', borderBottom: drawerTab === 'run' ? '2px solid var(--accent-primary)' : 'none', color: drawerTab === 'run' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
            >
              Test Arena
            </button>
            <button 
              className={`drawer-tab-btn ${drawerTab === 'few-shot' ? 'active' : ''}`}
              onClick={() => setDrawerTab('few-shot')}
              style={{ flex: 1, padding: '12px 6px', background: 'transparent', border: 'none', borderBottom: drawerTab === 'few-shot' ? '2px solid var(--accent-primary)' : 'none', color: drawerTab === 'few-shot' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
            >
              Few-Shot ({activePrompt.fewShotExamples?.length || 0})
            </button>
            <button 
              className={`drawer-tab-btn ${drawerTab === 'code' ? 'active' : ''}`}
              onClick={() => setDrawerTab('code')}
              style={{ flex: 1, padding: '12px 6px', background: 'transparent', border: 'none', borderBottom: drawerTab === 'code' ? '2px solid var(--accent-primary)' : 'none', color: drawerTab === 'code' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
            >
              Export
            </button>
            <button 
              className={`drawer-tab-btn ${drawerTab === 'history' ? 'active' : ''}`}
              onClick={() => setDrawerTab('history')}
              style={{ flex: 1, padding: '12px 6px', background: 'transparent', border: 'none', borderBottom: drawerTab === 'history' ? '2px solid var(--accent-primary)' : 'none', color: drawerTab === 'history' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
            >
              History
            </button>
          </div>

          {/* Drawer Body depending on tab */}
          {drawerTab === 'history' && (
            <div className="history-panel fade-in">
              <div className="drawer-header" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ fontSize: '14px' }}>Version History</h3>
                
                <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                  <button 
                    onClick={() => handleSelectGitHistoryTab('local')}
                    style={{ background: 'transparent', border: 'none', color: gitHistoryTab === 'local' ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderBottom: gitHistoryTab === 'local' ? '2px solid var(--accent-primary)' : 'none', paddingBottom: '4px' }}
                  >
                    Local Saves
                  </button>
                  <button 
                    onClick={() => handleSelectGitHistoryTab('git')}
                    style={{ background: 'transparent', border: 'none', color: gitHistoryTab === 'git' ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderBottom: gitHistoryTab === 'git' ? '2px solid var(--accent-primary)' : 'none', paddingBottom: '4px' }}
                  >
                    Git Commits
                  </button>
                </div>
              </div>
              
              <div className="history-list" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
                {gitHistoryTab === 'local' ? (() => {
                  const { nodes, tracks } = buildVersionGraph(activePrompt);
                  const trackColors = [
                    'var(--accent-primary)',
                    'var(--accent-secondary)',
                    '#06b6d4',
                    '#10b981',
                    '#f59e0b'
                  ];

                  if (nodes.length === 0) {
                    return (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        No versions saved yet.
                      </div>
                    );
                  }

                  return nodes.map((node, idx) => {
                    return (
                      <div key={node.id} className="history-graph-row" style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
                        {/* Graph track SVG visualizer */}
                        <div className="history-graph-track" style={{ width: '40px', position: 'relative', flexShrink: 0 }}>
                          <svg style={{ width: '100%', height: '100%', minHeight: '80px', overflow: 'visible' }}>
                            {/* 1. Draw track lines */}
                            {tracks.map((_track, t) => {
                              // Track 0 (main) always runs fully
                              if (t === 0) {
                                return (
                                  <line 
                                    key={t}
                                    x1={10} 
                                    y1={0} 
                                    x2={10} 
                                    y2="100%" 
                                    stroke={trackColors[0]} 
                                    strokeWidth={2}
                                    strokeOpacity={0.4}
                                  />
                                );
                              }
                              // Branch track is only active for rows up to its start
                              const bStartIdx = nodes.findIndex(n => n.track === t && n.isBranchStart);
                              if (bStartIdx !== -1 && idx <= bStartIdx) {
                                const isStartNode = idx === bStartIdx;
                                return (
                                  <g key={t}>
                                    {/* Draw vertical line down to 50% for start node, or fully for active rows above */}
                                    <line 
                                      x1={t * 12 + 10} 
                                      y1={0} 
                                      x2={t * 12 + 10} 
                                      y2={isStartNode ? "50%" : "100%"} 
                                      stroke={trackColors[t % trackColors.length]} 
                                      strokeWidth={2}
                                      strokeOpacity={0.4}
                                    />
                                    {/* For start node, draw diagonal connecting line from main line below to branch start */}
                                    {isStartNode && (
                                      <path 
                                        d={`M 10,80 Q ${t * 6 + 10},60 ${t * 12 + 10},40`}
                                        fill="none"
                                        stroke={trackColors[t % trackColors.length]}
                                        strokeWidth={2}
                                        strokeOpacity={0.6}
                                      />
                                    )}
                                  </g>
                                );
                              }
                              return null;
                            })}

                            {/* 2. Draw circle dot for current node commit */}
                            <circle 
                              cx={node.track * 12 + 10} 
                              cy={40} 
                              r={6} 
                              fill={trackColors[node.track % trackColors.length]} 
                              stroke="#1e1e24"
                              strokeWidth={2}
                            />
                          </svg>
                        </div>

                        {/* Version info card */}
                        <div className={`history-version-card glass-panel ${activeBranch === node.branchName ? 'active-branch-card' : ''}`} style={{ padding: '16px', flex: 1, position: 'relative' }}>
                          <div className="ver-card-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                            <div>
                              <span className="ver-number" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: trackColors[node.track % trackColors.length], fontSize: '14px' }}>v{node.version}</span>
                              <span className="ver-branch-badge" style={{ 
                                marginLeft: '8px', 
                                fontSize: '10px', 
                                padding: '1px 6px', 
                                borderRadius: '4px', 
                                background: node.track === 0 ? 'rgba(99, 102, 241, 0.1)' : 'rgba(236, 72, 153, 0.1)',
                                color: trackColors[node.track % trackColors.length],
                                border: `1px solid ${trackColors[node.track % trackColors.length]}33`
                              }}>
                                {node.branchName}
                              </span>
                            </div>
                            <span className="ver-date" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(node.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="ver-desc" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.4' }}>{node.description}</p>
                          <div className="ver-actions" style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn-secondary-mini" onClick={() => applyVersion(node.rawObject)}>Restore</button>
                            <button className="btn-secondary-mini" onClick={() => setCompareVersion(node.rawObject)}>Compare Diff</button>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })() : (
                  <>
                    {!gitEnabled && (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <p>Git history is not available. Ensure this project is initialized as a Git repository and changes to projects.json have been committed.</p>
                      </div>
                    )}
                    {gitEnabled && loadingGit && (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div className="loading-spinner" style={{ margin: '0 auto 8px' }}></div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading commits...</p>
                      </div>
                    )}
                    {gitEnabled && !loadingGit && gitHistory.length === 0 && (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <p>No commits tracked for this prompt yet. Commit your data/projects.json changes to Git to log history.</p>
                      </div>
                    )}
                    {gitEnabled && !loadingGit && gitHistory.map((commit, idx) => (
                      <div key={idx} className="history-version-card glass-panel" style={{ padding: '16px' }}>
                        <div className="ver-card-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span className="ver-number" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-primary)', fontSize: '12px' }}>
                            {commit.hash.substring(0, 7)}
                          </span>
                          <span className="ver-date" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {new Date(commit.date).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="ver-desc" style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '4px' }}>
                          {commit.message}
                        </p>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>
                          Author: {commit.author}
                        </span>
                        <div className="ver-actions" style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn-secondary-mini" onClick={() => applyGitCommit(commit)}>Restore</button>
                          <button className="btn-secondary-mini" onClick={() => setCompareGitCommit(commit)}>Compare Diff</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {drawerTab === 'run' && (
            <div className="runner-panel fade-in">
              <div className="drawer-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                <h3 style={{ fontSize: '14px' }}>Run Test Arena</h3>
              </div>

              <div className="runner-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Parameters */}
                <div className="runner-section">
                  <label>Model</label>
                  <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                    {models.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="runner-parameters-row">
                  <div>
                    <label>Temperature ({temperature})</label>
                    <input 
                      type="range" 
                      min="0" 
                      max="1.5" 
                      step="0.1" 
                      value={temperature} 
                      onChange={(e) => setTemperature(parseFloat(e.target.value))} 
                    />
                  </div>
                  <div>
                    <label>Max Tokens</label>
                    <input 
                      type="number" 
                      value={maxTokens} 
                      onChange={(e) => setMaxTokens(parseInt(e.target.value) || 128)} 
                    />
                  </div>
                </div>

                {/* Few shot toggle */}
                {activePrompt.fewShotExamples && activePrompt.fewShotExamples.length > 0 && (
                  <div className="runner-section" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="checkbox" 
                        checked={fewShotsEnabled} 
                        onChange={(e) => setFewShotsEnabled(e.target.checked)}
                        style={{ width: 'auto', cursor: 'pointer' }}
                      />
                      <span>Inject few-shots ({activePrompt.fewShotExamples.length} active)</span>
                    </label>
                  </div>
                )}

                {/* Variables Inputs */}
                {detectedVariables.length > 0 && (
                  <div className="runner-section">
                    <label>Prompt Variables</label>
                    {detectedVariables.map(v => (
                      <div key={v} className="variable-input-row">
                        <span className="var-label">{v}</span>
                        <input
                          type="text"
                          placeholder={`Enter value for {{${v}}}`}
                          value={runnerVariables[v] || ''}
                          onChange={(e) => setRunnerVariables({
                            ...runnerVariables,
                            [v]: e.target.value
                          })}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Image Upload for Vision Models */}
                {isVisionCapable && (
                  <div className="runner-section">
                    <label>Vision Assets (Images)</label>
                    <div className="image-uploader">
                      <label className="uploader-box">
                        <Upload size={16} />
                        <span>Upload Image</span>
                        <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                      </label>
                      
                      {imageFiles.length > 0 && (
                        <div className="uploaded-thumbnails">
                          {imageFiles.map((img, i) => (
                            <div key={i} className="thumbnail-wrapper">
                              <img src={img.base64} alt={`Upload ${i}`} />
                              <button className="del-thumb" onClick={() => setImageFiles(imageFiles.filter((_, idx) => idx !== i))}>×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Chat Simulator Toggle */}
                <div className="chat-sim-toggle">
                  <div className="chat-sim-toggle-label">
                    <span>💬</span>
                    <span>Chat Simulator Mode</span>
                  </div>
                  <label className="chat-sim-switch">
                    <input
                      type="checkbox"
                      checked={chatSimMode}
                      onChange={(e) => setChatSimMode(e.target.checked)}
                    />
                    <span className="chat-sim-slider"></span>
                  </label>
                </div>

                {!chatSimMode && (
                  <>
                    {/* Run Trigger */}
                    <button 
                      className="btn btn-primary run-button" 
                      disabled={running}
                      onClick={handleRunTest}
                    >
                      <Play size={16} />
                      {running ? 'Running Model...' : 'Execute Run'}
                    </button>

                    {/* Output */}
                    <div className="run-results-area">
                      {runError && (
                        <div className="run-error glass-panel">
                          <AlertCircle size={16} />
                          <span>{runError}</span>
                        </div>
                      )}

                      {runMetrics && (
                        <div className="run-metrics" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Latency: <b>{runMetrics.durationMs}ms</b></span>
                            <span>Tokens: <b>{runMetrics.tokenUsage?.totalTokens}</b></span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Token Split: {runMetrics.tokenUsage?.inputTokens}i / {runMetrics.tokenUsage?.outputTokens}o</span>
                            {runMetrics.costEstimate !== undefined && (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>Cost: ${runMetrics.costEstimate.toFixed(5)}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {runOutput && (
                        <div className="run-output glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                            <h5 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>Response:</h5>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {rawPayload && (
                                <button
                                  className="btn-secondary-mini"
                                  onClick={() => {
                                    setPayloadTab('request');
                                    setPayloadCopied(false);
                                    setShowPayloadModal(true);
                                  }}
                                  style={{ padding: '2px 6px', fontSize: '10px', background: 'rgba(99, 102, 241, 0.1)', borderColor: 'rgba(99, 102, 241, 0.3)', color: 'var(--accent-primary)', border: '1px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '4px' }}
                                >
                                  <Code2 size={10} /> Inspect
                                </button>
                              )}
                              <button 
                                className="btn-secondary-mini"
                                onClick={() => setOutputViewMode('raw')}
                                style={{ padding: '2px 6px', fontSize: '10px', background: outputViewMode === 'raw' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)', color: 'white', border: 'none', cursor: 'pointer' }}
                              >
                                Raw
                              </button>
                              <button 
                                className="btn-secondary-mini"
                                onClick={() => setOutputViewMode('preview')}
                                style={{ padding: '2px 6px', fontSize: '10px', background: outputViewMode === 'preview' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)', color: 'white', border: 'none', cursor: 'pointer' }}
                              >
                                Preview
                              </button>
                            </div>
                          </div>
                          
                          {outputViewMode === 'raw' ? (
                            <pre className="output-pre" style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{runOutput}</pre>
                          ) : (
                            <MarkdownRenderer content={runOutput} />
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {chatSimMode && (
                  <div className="chat-sim-container">
                    {chatHistory.length === 0 ? (
                      <div className="chat-sim-empty">
                        <div className="chat-sim-empty-icon">💬</div>
                        <p>Your compiled template will be sent as the first message to start a multi-turn conversation.</p>
                        <button
                          className="btn btn-primary chat-sim-start"
                          onClick={handleStartChat}
                          disabled={chatLoading}
                        >
                          <Play size={16} />
                          {chatLoading ? 'Starting...' : 'Start Chat'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="chat-sim-thread" ref={chatThreadRef}>
                          {chatHistory.map((msg, idx) => (
                            <div key={idx} className={`chat-msg ${msg.role}`}>
                              <div className="chat-msg-role">
                                {msg.role === 'user' ? 'You' : 'Assistant'}
                              </div>
                              <div className="chat-msg-content">
                                {msg.role === 'assistant' ? (
                                  <MarkdownRenderer content={msg.content} />
                                ) : (
                                  <span>{msg.content}</span>
                                )}
                              </div>
                            </div>
                          ))}
                          {chatLoading && (
                            <div className="chat-msg assistant">
                              <div className="chat-msg-role">Assistant</div>
                              <div className="chat-msg-content">
                                <div className="chat-typing-indicator">
                                  <span></span>
                                  <span></span>
                                  <span></span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="chat-sim-input-bar">
                          <input
                            type="text"
                            className="chat-sim-input"
                            placeholder="Type a follow-up message..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendChatMessage();
                              }
                            }}
                            disabled={chatLoading}
                          />
                          <button
                            className="chat-sim-send-btn"
                            onClick={handleSendChatMessage}
                            disabled={chatLoading || !chatInput.trim()}
                            title="Send message"
                          >
                            <SendHorizontal size={16} />
                          </button>
                          <button
                            className="chat-sim-clear-btn"
                            onClick={handleClearChat}
                            title="Clear chat"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {drawerTab === 'few-shot' && (
            <div className="few-shot-panel fade-in">
              <div className="drawer-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '14px' }}>Few-Shot Examples</h3>
                <button className="icon-btn-mini" onClick={() => setShowFewShotForm(!showFewShotForm)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '12px', cursor: 'pointer' }}>
                  <PlusCircle size={14} /> Add New
                </button>
              </div>

              <div style={{ padding: '20px' }}>
                {showFewShotForm && (
                  <form onSubmit={handleAddFewShot} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                    <h5 style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>New Example Pair</h5>
                    <div>
                      <label style={{ fontSize: '11px' }}>Example Input</label>
                      <textarea
                        rows={2}
                        placeholder="Insert user input example..."
                        value={newFewShotInput}
                        onChange={(e) => setNewFewShotInput(e.target.value)}
                        required
                        style={{ background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px' }}>Example Output</label>
                      <textarea
                        rows={3}
                        placeholder="Insert target LLM response..."
                        value={newFewShotOutput}
                        onChange={(e) => setNewFewShotOutput(e.target.value)}
                        required
                        style={{ background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px' }}>Description / Label (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. Edge case handling..."
                        value={newFewShotDesc}
                        onChange={(e) => setNewFewShotDesc(e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button type="submit" className="btn-primary-mini" style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', color: 'white', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Save Example</button>
                      <button type="button" className="btn-secondary-mini" onClick={() => setShowFewShotForm(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                    </div>
                  </form>
                )}

                {(!activePrompt.fewShotExamples || activePrompt.fewShotExamples.length === 0) ? (
                  <div style={{ textAlign: 'center', padding: '32px 10px', color: 'var(--text-muted)' }}>
                    <HelpCircle size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
                    <p style={{ fontSize: '12px' }}>No few-shot examples defined yet. Click "Add New" above to seed context examples.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {activePrompt.fewShotExamples.map((ex) => (
                      <div key={ex.id} className="glass-panel" style={{ padding: '14px', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ex.description || 'Example Pair'}</span>
                          <button 
                            onClick={() => handleDeleteFewShot(ex.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            title="Delete Example"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Input:</span>
                            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.1)', padding: '6px', borderRadius: '4px', fontFamily: 'var(--font-sans)', marginTop: '2px' }}>{ex.input}</pre>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Output:</span>
                            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.1)', padding: '6px', borderRadius: '4px', fontFamily: 'var(--font-sans)', marginTop: '2px' }}>{ex.output}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {drawerTab === 'code' && (
            <div className="code-export-panel fade-in">
              <div className="drawer-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                <h3 style={{ fontSize: '14px' }}>Export Integration Code</h3>
              </div>

              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px' }}>Language</label>
                    <select value={snippetLang} onChange={(e) => setSnippetLang(e.target.value as any)} style={{ padding: '6px 8px', fontSize: '12px' }}>
                      <option value="python">Python</option>
                      <option value="js">JavaScript (ESM)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px' }}>SDK Provider</label>
                    <select value={snippetSdk} onChange={(e) => setSnippetSdk(e.target.value as any)} style={{ padding: '6px 8px', fontSize: '12px' }}>
                      <option value="gemini">Google GenAI</option>
                      <option value="claude">Anthropic Claude</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Generated Code Snippet:</span>
                    <button 
                      className="btn-secondary-mini"
                      style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      onClick={() => {
                        navigator.clipboard.writeText(getCodeSnippet(snippetLang, snippetSdk));
                        alert('Copied snippet to clipboard!');
                      }}
                    >
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                  <pre style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '11px', fontFamily: 'var(--font-mono)', overflowX: 'auto', maxHeight: '420px', whiteSpace: 'pre' }}>
                    <code>{getCodeSnippet(snippetLang, snippetSdk)}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Branch Modals & Payload Inspector Modal */}
      {showBranchModal && (
        <div className="branch-modal-backdrop" onClick={() => setShowBranchModal(false)}>
          <div className="branch-modal glass-panel-glow" onClick={(e) => e.stopPropagation()}>
            <div className="branch-modal-header">
              <h3>Create Branch</h3>
              <button className="branch-modal-close" onClick={() => setShowBranchModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="branch-modal-body">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Create a new development branch from the current version.
              </p>
              <input
                type="text"
                placeholder="Branch name (e.g. experiment/greeting)..."
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  outline: 'none',
                  marginBottom: '16px'
                }}
              />
            </div>
            <div className="branch-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setShowBranchModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
                Create Branch
              </button>
            </div>
          </div>
        </div>
      )}

      {showMergeModal && (
        <div className="branch-modal-backdrop" onClick={() => setShowMergeModal(false)}>
          <div className="branch-modal glass-panel-glow" onClick={(e) => e.stopPropagation()}>
            <div className="branch-modal-header">
              <h3>Merge Branch</h3>
              <button className="branch-modal-close" onClick={() => setShowMergeModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="branch-modal-body">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Merge branch <b>{activeBranch}</b> back into <b>main</b>.
              </p>
              <input
                type="text"
                placeholder="Merge commit message..."
                value={mergeMessage}
                onChange={(e) => setMergeMessage(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  outline: 'none',
                  marginBottom: '16px'
                }}
              />
            </div>
            <div className="branch-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setShowMergeModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleMergeBranch}>
                Merge & Delete Branch
              </button>
            </div>
          </div>
        </div>
      )}

      {showPayloadModal && rawPayload && (
        <div
          className="payload-inspector-backdrop"
          onClick={() => setShowPayloadModal(false)}
        >
          <div
            className="payload-inspector-modal glass-panel-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="payload-inspector-header">
              <div className="payload-inspector-title">
                <Code2 size={16} style={{ color: 'var(--accent-primary)' }} />
                <span>API Payload Inspector</span>
              </div>
              <button
                className="payload-inspector-close"
                onClick={() => setShowPayloadModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="payload-inspector-tabs">
              <button
                className={`payload-tab-btn ${payloadTab === 'request' ? 'active' : ''}`}
                onClick={() => { setPayloadTab('request'); setPayloadCopied(false); }}
              >
                Request
              </button>
              <button
                className={`payload-tab-btn ${payloadTab === 'response' ? 'active' : ''}`}
                onClick={() => { setPayloadTab('response'); setPayloadCopied(false); }}
              >
                Response
              </button>
            </div>

            <div className="payload-inspector-body">
              <pre className="payload-json-block">
                {JSON.stringify(
                  payloadTab === 'request'
                    ? rawPayload.rawRequest ?? { note: 'No raw request data available.' }
                    : rawPayload.rawResponse ?? { note: 'No raw response data available.' },
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="payload-inspector-footer">
              <button
                className="payload-copy-btn"
                onClick={() => {
                  const data = payloadTab === 'request'
                    ? rawPayload.rawRequest
                    : rawPayload.rawResponse;
                  navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                  setPayloadCopied(true);
                  setTimeout(() => setPayloadCopied(false), 2000);
                }}
              >
                {payloadCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy JSON</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default PromptStudio;
