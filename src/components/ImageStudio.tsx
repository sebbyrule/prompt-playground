import React, { useState, useEffect } from 'react';
import './ImageStudio.css';
import api from '../utils/api';
import { 
  Play, 
  Save, 
  Trash2, 
  Copy, 
  Sliders, 
  Code, 
  X, 
  Download, 
  Loader2, 
  Image as ImageIcon 
} from 'lucide-react';

interface ImagePrompt {
  id?: string;
  name: string;
  positivePrompt: string;
  negativePrompt: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  customWorkflow?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface GalleryItem {
  id: string;
  promptId: string | null;
  promptName: string;
  positivePrompt: string;
  negativePrompt: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  imagePath: string;
  createdAt: string;
}

export const ImageStudio: React.FC = () => {
  // Saved prompts state
  const [savedPrompts, setSavedPrompts] = useState<ImagePrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [newPromptName, setNewPromptName] = useState<string>('');

  // Active prompt configuration
  const [positivePrompt, setPositivePrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>('embedding:easynegative, deformed, bad eyes, blurry, low contrast, duplicate, draft');
  const [checkpoint, setCheckpoint] = useState<string>('');
  const [checkpointsList, setCheckpointsList] = useState<string[]>([]);
  const [width, setWidth] = useState<number>(512);
  const [height, setHeight] = useState<number>(512);
  const [steps, setSteps] = useState<number>(20);
  const [cfg, setCfg] = useState<number>(8);
  const [sampler, setSampler] = useState<string>('euler');
  const [scheduler, setScheduler] = useState<string>('normal');
  const [seed, setSeed] = useState<number>(-1);
  const [randomizeSeed, setRandomizeSeed] = useState<boolean>(true);
  const [useCustomWorkflow, setUseCustomWorkflow] = useState<boolean>(false);
  const [customWorkflow, setCustomWorkflow] = useState<string>('');

  // Gallery state
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<GalleryItem | null>(null);

  // Status/Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [checkpointsLoading, setCheckpointsLoading] = useState<boolean>(false);

  // Constants
  const samplers = [
    'euler', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral', 
    'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 
    'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 
    'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddim', 'uni_pc'
  ];
  const schedulers = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'];
  const dimensions = [512, 768, 1024];

  useEffect(() => {
    fetchPrompts();
    fetchGallery();
    fetchCheckpoints();
  }, []);

  const showStatus = (text: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) => {
    setStatusMessage({ text, type });
    if (type !== 'info') {
      setTimeout(() => setStatusMessage(null), duration);
    }
  };

  const fetchPrompts = async () => {
    try {
      const data = await api.get('/api/image-studio/prompts');
      setSavedPrompts(data);
    } catch (err: any) {
      showStatus('Failed to load prompts: ' + err.message, 'error');
    }
  };

  const fetchGallery = async () => {
    try {
      const data = await api.get('/api/image-studio/gallery');
      setGallery(data);
    } catch (err: any) {
      showStatus('Failed to load gallery: ' + err.message, 'error');
    }
  };

  const fetchCheckpoints = async () => {
    setCheckpointsLoading(true);
    try {
      const data = await api.get('/api/image-studio/comfy-checkpoints');
      setCheckpointsList(data);
      if (data.length > 0 && !checkpoint) {
        setCheckpoint(data[0]);
      }
    } catch (err: any) {
      console.warn('Could not retrieve comfy checkpoints:', err.message);
    } finally {
      setCheckpointsLoading(false);
    }
  };

  const handlePromptSelect = (promptId: string) => {
    setSelectedPromptId(promptId);
    if (!promptId) {
      setPositivePrompt('');
      return;
    }
    const found = savedPrompts.find(p => p.id === promptId);
    if (found) {
      setPositivePrompt(found.positivePrompt);
      setNegativePrompt(found.negativePrompt);
      setCheckpoint(found.checkpoint);
      setWidth(found.width);
      setHeight(found.height);
      setSteps(found.steps);
      setCfg(found.cfg);
      setSampler(found.sampler);
      setScheduler(found.scheduler);
      setSeed(found.seed);
      setRandomizeSeed(found.seed === -1);
      setUseCustomWorkflow(!!found.customWorkflow);
      setCustomWorkflow(found.customWorkflow || '');
    }
  };

  const handleSavePrompt = async () => {
    let promptName = newPromptName.trim();
    
    // If updating existing
    if (selectedPromptId && !promptName) {
      const found = savedPrompts.find(p => p.id === selectedPromptId);
      if (found) promptName = found.name;
    }

    if (!promptName) {
      showStatus('Please specify a prompt name.', 'error');
      return;
    }

    const payload: ImagePrompt = {
      id: selectedPromptId || undefined,
      name: promptName,
      positivePrompt,
      negativePrompt,
      checkpoint,
      width,
      height,
      steps,
      cfg,
      sampler,
      scheduler,
      seed: randomizeSeed ? -1 : seed,
      customWorkflow: useCustomWorkflow ? customWorkflow : undefined
    };

    try {
      const saved = await api.post('/api/image-studio/prompts', payload);
      showStatus('Prompt saved successfully!', 'success');
      setNewPromptName('');
      await fetchPrompts();
      setSelectedPromptId(saved.id);
    } catch (err: any) {
      showStatus('Failed to save prompt: ' + err.message, 'error');
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return;
    if (!window.confirm('Delete this saved prompt?')) return;
    try {
      await api.delete(`/api/image-studio/prompts/${selectedPromptId}`);
      showStatus('Prompt deleted.', 'success');
      setSelectedPromptId('');
      setPositivePrompt('');
      await fetchPrompts();
    } catch (err: any) {
      showStatus('Failed to delete prompt: ' + err.message, 'error');
    }
  };

  const handleGenerate = async () => {
    if (!positivePrompt.trim()) {
      showStatus('Positive prompt cannot be empty.', 'error');
      return;
    }
    if (!checkpoint && checkpointsList.length === 0) {
      showStatus('Please configure or select a checkpoint.', 'error');
      return;
    }

    setIsLoading(true);
    showStatus('Submitting prompt to ComfyUI...', 'info');

    const calculatedSeed = randomizeSeed ? Math.floor(Math.random() * 100000000000) : seed;

    const payload = {
      promptId: selectedPromptId || null,
      promptName: selectedPromptId ? savedPrompts.find(p => p.id === selectedPromptId)?.name : 'Ad-hoc Prompt',
      positivePrompt,
      negativePrompt,
      checkpoint: checkpoint || checkpointsList[0],
      width,
      height,
      steps,
      cfg,
      sampler,
      scheduler,
      seed: calculatedSeed,
      customWorkflow: useCustomWorkflow ? customWorkflow : undefined
    };

    try {
      const res = await api.post('/api/image-studio/generate', payload);
      showStatus('Image generated successfully!', 'success');
      await fetchGallery();
      if (res.items && res.items.length > 0) {
        setSelectedImage(res.items[0]);
      }
    } catch (err: any) {
      showStatus('Generation failed: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteGalleryItem = async (itemId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this image from your history?')) return;
    try {
      await api.delete(`/api/image-studio/gallery/${itemId}`);
      showStatus('Image deleted.', 'success');
      setGallery(gallery.filter(i => i.id !== itemId));
      if (selectedImage?.id === itemId) {
        setSelectedImage(null);
      }
    } catch (err: any) {
      showStatus('Failed to delete image: ' + err.message, 'error');
    }
  };

  const handleLoadParams = (item: GalleryItem) => {
    setPositivePrompt(item.positivePrompt);
    setNegativePrompt(item.negativePrompt);
    setCheckpoint(item.checkpoint);
    setWidth(item.width);
    setHeight(item.height);
    setSteps(item.steps);
    setCfg(item.cfg);
    setSampler(item.sampler);
    setScheduler(item.scheduler);
    setSeed(item.seed);
    setRandomizeSeed(false);
    setSelectedImage(null);
    showStatus('Parameters loaded into editor!', 'success');
  };

  return (
    <div className="image-studio-container fade-in">
      <div className="image-studio-header">
        <h1>Stable Diffusion Studio</h1>
        <p>Compose image prompts, tweak generation variables, and interface with your local ComfyUI instance.</p>
      </div>

      <div className="image-studio-content">
        {/* Left Side: Parameters Form */}
        <div className="params-pane glass-panel">
          <div className="pane-section border-bottom">
            <h3 className="section-title"><Sliders size={16} /> Parameters</h3>
            
            {/* Prompt Selector */}
            <div className="form-row flex-gap">
              <div className="form-group flex-1">
                <label>Saved Prompts</label>
                <select 
                  value={selectedPromptId} 
                  onChange={(e) => handlePromptSelect(e.target.value)}
                >
                  <option value="">-- Create New / Ad-hoc --</option>
                  {savedPrompts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {selectedPromptId && (
                <button 
                  className="btn btn-icon btn-danger-hover" 
                  onClick={handleDeletePrompt}
                  title="Delete saved prompt"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Save Prompt Group */}
            <div className="form-row flex-gap align-end">
              <div className="form-group flex-1">
                <label>Save As Name</label>
                <input 
                  type="text" 
                  placeholder={selectedPromptId ? "Update current prompt" : "Enter prompt name..."}
                  value={newPromptName}
                  onChange={(e) => setNewPromptName(e.target.value)}
                />
              </div>
              <button className="btn btn-secondary" onClick={handleSavePrompt}>
                <Save size={16} />
                {selectedPromptId && !newPromptName ? 'Update' : 'Save'}
              </button>
            </div>
          </div>

          <div className="pane-section border-bottom scrollable-section">
            {/* Checkpoint Loader */}
            <div className="form-group">
              <label>Model Checkpoint</label>
              {checkpointsLoading ? (
                <div className="loader-row"><Loader2 className="spinning" size={14} /> Loading checkpoints...</div>
              ) : (
                <div className="flex-gap">
                  <select 
                    value={checkpoint} 
                    onChange={(e) => setCheckpoint(e.target.value)}
                    className="flex-1"
                  >
                    {checkpointsList.length === 0 && <option value="">-- No ComfyUI Models Detected --</option>}
                    {checkpointsList.map(ckpt => (
                      <option key={ckpt} value={ckpt}>{ckpt}</option>
                    ))}
                  </select>
                  <button className="btn btn-secondary btn-small" onClick={fetchCheckpoints} title="Refresh Model list">Refresh</button>
                </div>
              )}
            </div>

            {/* Positive Prompt */}
            <div className="form-group">
              <label>Positive Prompt</label>
              <textarea 
                className="prompt-textarea positive" 
                placeholder="A high quality masterpiece photo of..."
                value={positivePrompt}
                onChange={(e) => setPositivePrompt(e.target.value)}
              />
            </div>

            {/* Negative Prompt */}
            <div className="form-group">
              <label>Negative Prompt</label>
              <textarea 
                className="prompt-textarea negative" 
                placeholder="ugly, deformed, bad quality..."
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </div>

            {/* Dimensions */}
            <div className="form-row flex-gap">
              <div className="form-group flex-1">
                <label>Width</label>
                <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                  {dimensions.map(d => <option key={d} value={d}>{d}px</option>)}
                  {!dimensions.includes(width) && <option value={width}>{width}px</option>}
                </select>
              </div>
              <div className="form-group flex-1">
                <label>Height</label>
                <select value={height} onChange={(e) => setHeight(Number(e.target.value))}>
                  {dimensions.map(d => <option key={d} value={d}>{d}px</option>)}
                  {!dimensions.includes(height) && <option value={height}>{height}px</option>}
                </select>
              </div>
            </div>

            {/* Custom Workflow Toggle */}
            <div className="form-group toggle-row">
              <input 
                type="checkbox" 
                id="use-custom" 
                checked={useCustomWorkflow}
                onChange={(e) => setUseCustomWorkflow(e.target.checked)}
              />
              <label htmlFor="use-custom"><Code size={14} style={{ marginRight: '4px' }} /> Use Custom ComfyUI JSON Workflow</label>
            </div>

            {useCustomWorkflow ? (
              <div className="form-group">
                <label>Custom ComfyUI API JSON</label>
                <textarea 
                  className="code-textarea"
                  placeholder='{"3": {"inputs": {"seed": {{seed}}, "text": "{{positive_prompt}}"...'
                  value={customWorkflow}
                  onChange={(e) => setCustomWorkflow(e.target.value)}
                />
                <small className="help-text">Use variables like {"{{positive_prompt}}"}, {"{{negative_prompt}}"}, {"{{seed}}"}, {"{{steps}}"}, {"{{cfg}}"}, {"{{width}}"}, {"{{height}}"}, {"{{checkpoint}}"}.</small>
              </div>
            ) : (
              <>
                {/* Sampling Settings */}
                <div className="form-row flex-gap">
                  <div className="form-group flex-1">
                    <label>Steps</label>
                    <input type="number" min={1} max={150} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
                  </div>
                  <div className="form-group flex-1">
                    <label>CFG Scale</label>
                    <input type="number" min={1} max={30} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} />
                  </div>
                </div>

                <div className="form-row flex-gap">
                  <div className="form-group flex-1">
                    <label>Sampler</label>
                    <select value={sampler} onChange={(e) => setSampler(e.target.value)}>
                      {samplers.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group flex-1">
                    <label>Scheduler</label>
                    <select value={scheduler} onChange={(e) => setScheduler(e.target.value)}>
                      {schedulers.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Seed */}
            <div className="form-row flex-gap align-center" style={{ marginTop: '10px' }}>
              <div className="form-group flex-1">
                <label>Seed</label>
                <input 
                  type="number" 
                  disabled={randomizeSeed} 
                  placeholder="Random seed..."
                  value={seed === -1 ? '' : seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </div>
              <div className="form-group toggle-row" style={{ marginTop: '20px' }}>
                <input 
                  type="checkbox" 
                  id="randomize" 
                  checked={randomizeSeed}
                  onChange={(e) => setRandomizeSeed(e.target.checked)}
                />
                <label htmlFor="randomize">Randomize</label>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="pane-section form-actions-row">
            {statusMessage && statusMessage.type === 'info' && (
              <div className="progress-banner">
                <Loader2 className="spinning" size={16} />
                <span>{statusMessage.text}</span>
              </div>
            )}
            
            <button 
              className="btn btn-primary btn-generate" 
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="spinning" size={18} />
                  Generating...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Generate Image
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Side: Gallery grid */}
        <div className="gallery-pane glass-panel">
          <h3 className="section-title"><ImageIcon size={16} /> Image Gallery ({gallery.length})</h3>

          {gallery.length === 0 ? (
            <div className="empty-gallery">
              <ImageIcon size={48} className="empty-icon" />
              <h4>No Generated Images</h4>
              <p>When you click "Generate Image", the output will be fetched from ComfyUI and saved persistently here.</p>
            </div>
          ) : (
            <div className="gallery-grid">
              {gallery.map(item => (
                <div 
                  key={item.id} 
                  className="gallery-card"
                  onClick={() => setSelectedImage(item)}
                >
                  <img src={item.imagePath} alt={item.promptName} loading="lazy" />
                  <div className="card-overlay">
                    <span className="card-title">{item.promptName}</span>
                    <button 
                      className="btn-delete-card" 
                      onClick={(e) => handleDeleteGalleryItem(item.id, e)}
                      title="Delete image"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selected Image Detail Overlay Modal */}
      {selectedImage && (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedImage(null)}><X size={20} /></button>
            
            <div className="modal-layout">
              <div className="modal-preview-pane">
                <img src={selectedImage.imagePath} alt={selectedImage.promptName} />
                <div className="preview-actions">
                  <a 
                    href={selectedImage.imagePath} 
                    download={`${selectedImage.promptName.replace(/\s+/g, '_')}_${selectedImage.seed}.png`} 
                    className="btn btn-secondary btn-small"
                  >
                    <Download size={14} /> Download Image
                  </a>
                </div>
              </div>
              
              <div className="modal-metadata-pane">
                <h3>{selectedImage.promptName}</h3>
                <small className="meta-date">Generated on {new Date(selectedImage.createdAt).toLocaleString()}</small>
                
                <div className="meta-scroll-content">
                  <div className="meta-group">
                    <span className="meta-label">Model Checkpoint</span>
                    <span className="meta-value code-font">{selectedImage.checkpoint}</span>
                  </div>

                  <div className="meta-group">
                    <span className="meta-label">Positive Prompt</span>
                    <p className="meta-text">{selectedImage.positivePrompt}</p>
                    <button 
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedImage.positivePrompt);
                        showStatus('Copied positive prompt!', 'success');
                      }}
                    >
                      <Copy size={12} /> Copy Positive Prompt
                    </button>
                  </div>

                  {selectedImage.negativePrompt && (
                    <div className="meta-group">
                      <span className="meta-label">Negative Prompt</span>
                      <p className="meta-text secondary">{selectedImage.negativePrompt}</p>
                    </div>
                  )}

                  <div className="meta-grid">
                    <div className="meta-group">
                      <span className="meta-label">Dimensions</span>
                      <span className="meta-value">{selectedImage.width} x {selectedImage.height}px</span>
                    </div>
                    <div className="meta-group">
                      <span className="meta-label">Seed</span>
                      <span className="meta-value code-font">{selectedImage.seed}</span>
                    </div>
                    <div className="meta-group">
                      <span className="meta-label">Steps</span>
                      <span className="meta-value">{selectedImage.steps}</span>
                    </div>
                    <div className="meta-group">
                      <span className="meta-label">CFG Scale</span>
                      <span className="meta-value">{selectedImage.cfg}</span>
                    </div>
                    <div className="meta-group">
                      <span className="meta-label">Sampler</span>
                      <span className="meta-value">{selectedImage.sampler}</span>
                    </div>
                    <div className="meta-group">
                      <span className="meta-label">Scheduler</span>
                      <span className="meta-value">{selectedImage.scheduler}</span>
                    </div>
                  </div>
                </div>

                <div className="modal-actions-row border-top">
                  <button 
                    className="btn btn-primary" 
                    onClick={() => handleLoadParams(selectedImage)}
                  >
                    <Sliders size={16} /> Load Params into Editor
                  </button>
                  <button 
                    className="btn btn-secondary btn-danger-hover"
                    onClick={() => handleDeleteGalleryItem(selectedImage.id)}
                  >
                    <Trash2 size={16} /> Delete from History
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
