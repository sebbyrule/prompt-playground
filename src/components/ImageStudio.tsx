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
  Image as ImageIcon,
  Plus,
  ArrowRight,
  Info
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
  loras?: { name: string; strength: number }[];
  denoise?: number;
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

// PNG Chunk Parser for extracting ComfyUI parameters
function parsePngMetadata(arrayBuffer: ArrayBuffer): { prompt?: any; workflow?: any } {
  const view = new DataView(arrayBuffer);
  // Check PNG signature
  if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
    throw new Error('Not a valid PNG image');
  }
  
  let offset = 8;
  const result: any = {};
  const decoder = new TextDecoder('utf-8');
  
  while (offset < view.byteLength) {
    if (offset + 8 > view.byteLength) break;
    const length = view.getUint32(offset);
    const typeBytes = new Uint8Array(arrayBuffer, offset + 4, 4);
    const type = decoder.decode(typeBytes);
    
    if (type === 'tEXt') {
      const dataBytes = new Uint8Array(arrayBuffer, offset + 8, length);
      let nullIndex = 0;
      while (nullIndex < dataBytes.length && dataBytes[nullIndex] !== 0) {
        nullIndex++;
      }
      
      const key = decoder.decode(dataBytes.subarray(0, nullIndex));
      const value = decoder.decode(dataBytes.subarray(nullIndex + 1));
      
      if (key === 'prompt') {
        try {
          result.prompt = JSON.parse(value);
        } catch (e) {
          result.prompt = value;
        }
      } else if (key === 'workflow') {
        try {
          result.workflow = JSON.parse(value);
        } catch (e) {
          result.workflow = value;
        }
      }
    }
    
    offset += 12 + length;
  }
  
  return result;
}

// Trace prompt parameters from ComfyUI Node Graph Object
function extractParamsFromComfyPrompt(promptObj: any) {
  const params: any = {};
  
  // Find KSampler node
  let samplerNode: any = null;
  for (const id in promptObj) {
    if (promptObj[id].class_type === 'KSampler') {
      samplerNode = promptObj[id];
      break;
    }
  }
  
  if (samplerNode) {
    params.seed = samplerNode.inputs.seed;
    params.steps = samplerNode.inputs.steps;
    params.cfg = samplerNode.inputs.cfg;
    params.sampler = samplerNode.inputs.sampler_name;
    params.scheduler = samplerNode.inputs.scheduler;
    params.denoise = samplerNode.inputs.denoise;
    
    const posLink = samplerNode.inputs.positive;
    if (posLink && Array.isArray(posLink)) {
      const posNodeId = posLink[0];
      const posNode = promptObj[posNodeId];
      if (posNode && posNode.inputs && typeof posNode.inputs.text === 'string') {
        params.positivePrompt = posNode.inputs.text;
      }
    }
    
    const negLink = samplerNode.inputs.negative;
    if (negLink && Array.isArray(negLink)) {
      const negNodeId = negLink[0];
      const negNode = promptObj[negNodeId];
      if (negNode && negNode.inputs && typeof negNode.inputs.text === 'string') {
        params.negativePrompt = negNode.inputs.text;
      }
    }
    
    const latentLink = samplerNode.inputs.latent_image;
    if (latentLink && Array.isArray(latentLink)) {
      const latentNodeId = latentLink[0];
      const latentNode = promptObj[latentNodeId];
      if (latentNode && latentNode.inputs) {
        params.width = latentNode.inputs.width;
        params.height = latentNode.inputs.height;
      }
    }
    
    const modelLink = samplerNode.inputs.model;
    if (modelLink && Array.isArray(modelLink)) {
      let modelNodeId = modelLink[0];
      let modelNode = promptObj[modelNodeId];
      // Walk back through LoRAs
      while (modelNode && modelNode.class_type === 'LoraLoader') {
        const nextModelLink = modelNode.inputs.model;
        if (nextModelLink && Array.isArray(nextModelLink)) {
          modelNodeId = nextModelLink[0];
          modelNode = promptObj[modelNodeId];
        } else {
          break;
        }
      }
      if (modelNode && modelNode.class_type === 'CheckpointLoaderSimple' && modelNode.inputs) {
        params.checkpoint = modelNode.inputs.ckpt_name;
      }
    }
  } else {
    for (const id in promptObj) {
      const node = promptObj[id];
      if (node.class_type === 'CheckpointLoaderSimple') {
        params.checkpoint = node.inputs.ckpt_name;
      } else if (node.class_type === 'EmptyLatentImage') {
        params.width = node.inputs.width;
        params.height = node.inputs.height;
      }
    }
  }
  
  return params;
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

  // LoRA settings state
  const [loras, setLoras] = useState<{ name: string; strength: number }[]>([]);
  const [lorasList, setLorasList] = useState<string[]>([]);

  // img2img settings state
  const [initialImage, setInitialImage] = useState<string | null>(null);
  const [denoise, setDenoise] = useState<number>(0.6);

  // Aspect ratio presets state
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');

  // PNG Info state
  const [pngInfoParams, setPngInfoParams] = useState<any | null>(null);
  const [pngInfoFilename, setPngInfoFilename] = useState<string>('');

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
    fetchLoras();
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

  const fetchLoras = async () => {
    try {
      const data = await api.get('/api/image-studio/comfy-loras');
      setLorasList(data);
    } catch (err: any) {
      console.warn('Could not retrieve comfy loras:', err.message);
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
      setLoras(found.loras || []);
      setDenoise(found.denoise || 0.6);
    }
  };

  const handleSavePrompt = async () => {
    let promptName = newPromptName.trim();
    
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
      customWorkflow: useCustomWorkflow ? customWorkflow : undefined,
      loras,
      denoise: initialImage ? denoise : undefined
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
      customWorkflow: useCustomWorkflow ? customWorkflow : undefined,
      loras,
      initialImage: initialImage || undefined,
      denoise: initialImage ? denoise : undefined
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

  // Add / Manage LoRAs
  const handleAddLora = () => {
    if (lorasList.length === 0) {
      showStatus('No comfy LoRA files detected.', 'error');
      return;
    }
    setLoras([...loras, { name: lorasList[0], strength: 1.0 }]);
  };

  const handleRemoveLora = (index: number) => {
    setLoras(loras.filter((_, idx) => idx !== index));
  };

  const handleLoraChange = (index: number, field: 'name' | 'strength', value: any) => {
    const updated = [...loras];
    if (field === 'name') {
      updated[index].name = value;
    } else {
      updated[index].strength = Number(value);
    }
    setLoras(updated);
  };

  // img2img Initial Image file picker
  const handleInitialImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      setInitialImage(event.target?.result as string);
      showStatus('Initial image loaded for img2img!', 'success');
    };
    reader.readAsDataURL(file);
  };

  const handleClearInitialImage = () => {
    setInitialImage(null);
    showStatus('Initial image cleared. Switched back to txt2img.', 'info');
  };

  // Aspect ratio resolution snapping
  const handleAspectRatioSelect = (ratio: string) => {
    setAspectRatio(ratio);
    const isXL = checkpoint.toLowerCase().includes('xl') || (checkpointsList[0] && checkpointsList[0].toLowerCase().includes('xl'));
    const base = isXL ? 1024 : 512;
    
    switch (ratio) {
      case '1:1':
        setWidth(base);
        setHeight(base);
        break;
      case '3:2':
        setWidth(isXL ? 1216 : 768);
        setHeight(isXL ? 832 : 512);
        break;
      case '2:3':
        setWidth(isXL ? 832 : 512);
        setHeight(isXL ? 1216 : 768);
        break;
      case '16:9':
        setWidth(isXL ? 1344 : 768);
        setHeight(isXL ? 768 : 432);
        break;
      case '9:16':
        setWidth(isXL ? 768 : 432);
        setHeight(isXL ? 1344 : 768);
        break;
      case '4:3':
        setWidth(isXL ? 1152 : 768);
        setHeight(isXL ? 896 : 576);
        break;
      case '3:4':
        setWidth(isXL ? 896 : 576);
        setHeight(isXL ? 1152 : 768);
        break;
      default:
        break;
    }
  };

  // PNG drop file reader for PNG Info
  const handlePngFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setPngInfoFilename(file.name);
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      try {
        const metadata = parsePngMetadata(buffer);
        if (metadata.prompt) {
          const parsedParams = extractParamsFromComfyPrompt(metadata.prompt);
          setPngInfoParams(parsedParams);
          showStatus('Successfully parsed PNG generation metadata!', 'success');
        } else {
          setPngInfoParams(null);
          showStatus('No ComfyUI metadata found inside this PNG file.', 'error');
        }
      } catch (err: any) {
        setPngInfoParams(null);
        showStatus('Failed to parse PNG metadata: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleLoadPngInfoParams = () => {
    if (!pngInfoParams) return;
    if (pngInfoParams.positivePrompt !== undefined) setPositivePrompt(pngInfoParams.positivePrompt);
    if (pngInfoParams.negativePrompt !== undefined) setNegativePrompt(pngInfoParams.negativePrompt);
    if (pngInfoParams.checkpoint !== undefined) setCheckpoint(pngInfoParams.checkpoint);
    if (pngInfoParams.width !== undefined) setWidth(pngInfoParams.width);
    if (pngInfoParams.height !== undefined) setHeight(pngInfoParams.height);
    if (pngInfoParams.steps !== undefined) setSteps(pngInfoParams.steps);
    if (pngInfoParams.cfg !== undefined) setCfg(pngInfoParams.cfg);
    if (pngInfoParams.sampler !== undefined) setSampler(pngInfoParams.sampler);
    if (pngInfoParams.scheduler !== undefined) setScheduler(pngInfoParams.scheduler);
    if (pngInfoParams.seed !== undefined) {
      setSeed(pngInfoParams.seed);
      setRandomizeSeed(false);
    }
    setPngInfoParams(null);
    setPngInfoFilename('');
    showStatus('Loaded PNG parameters into active editor!', 'success');
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

            {/* LoRAs Section */}
            <div className="form-group loras-section">
              <div className="section-header-row">
                <label>LoRAs ({loras.length})</label>
                <button className="btn btn-secondary btn-small" onClick={handleAddLora}><Plus size={12} /> Add LoRA</button>
              </div>
              {loras.length > 0 && (
                <div className="loras-list-container">
                  {loras.map((lora, index) => (
                    <div key={index} className="lora-row border-panel">
                      <select 
                        value={lora.name}
                        onChange={(e) => handleLoraChange(index, 'name', e.target.value)}
                        className="lora-select"
                      >
                        {lorasList.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                      <div className="lora-weight-control">
                        <input 
                          type="range" 
                          min={0.0} 
                          max={1.5} 
                          step={0.05} 
                          value={lora.strength} 
                          onChange={(e) => handleLoraChange(index, 'strength', e.target.value)}
                        />
                        <span className="weight-badge">{lora.strength.toFixed(2)}</span>
                      </div>
                      <button className="btn btn-icon btn-danger-hover" onClick={() => handleRemoveLora(index)}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aspect Ratio Snapper */}
            <div className="form-group">
              <label>Aspect Ratio Presets</label>
              <div className="ratio-presets">
                {['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                  <button 
                    key={ratio}
                    className={`preset-chip ${aspectRatio === ratio ? 'active' : ''}`}
                    onClick={() => handleAspectRatioSelect(ratio)}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {/* Dimensions */}
            <div className="form-row flex-gap">
              <div className="form-group flex-1">
                <label>Width</label>
                <select value={width} onChange={(e) => { setWidth(Number(e.target.value)); setAspectRatio('custom'); }}>
                  {dimensions.map(d => <option key={d} value={d}>{d}px</option>)}
                  {!dimensions.includes(width) && <option value={width}>{width}px</option>}
                </select>
              </div>
              <div className="form-group flex-1">
                <label>Height</label>
                <select value={height} onChange={(e) => { setHeight(Number(e.target.value)); setAspectRatio('custom'); }}>
                  {dimensions.map(d => <option key={d} value={d}>{d}px</option>)}
                  {!dimensions.includes(height) && <option value={height}>{height}px</option>}
                </select>
              </div>
            </div>

            {/* img2img Initial Image Uploader */}
            <div className="form-group img2img-section border-panel">
              <label>Initial Image (img2img)</label>
              {initialImage ? (
                <div className="initial-image-preview-container">
                  <img src={initialImage} className="initial-image-thumbnail" alt="Initial img2img target" />
                  <div className="initial-image-controls">
                    <button className="btn btn-secondary btn-small" onClick={handleClearInitialImage}><X size={12} /> Clear Image</button>
                    <div className="denoise-slider-container">
                      <label className="denoise-label">Denoise strength: <span>{denoise.toFixed(2)}</span></label>
                      <input 
                        type="range" 
                        min={0.0} 
                        max={1.0} 
                        step={0.05} 
                        value={denoise} 
                        onChange={(e) => setDenoise(Number(e.target.value))} 
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="img2img-upload-dropzone">
                  <ImageIcon size={24} className="upload-icon" />
                  <span>Click to upload image target</span>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleInitialImageUpload}
                  />
                </div>
              )}
            </div>

            {/* Custom Workflow Toggle */}
            <div className="form-group toggle-row" style={{ marginTop: '16px' }}>
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

        {/* Right Side: Gallery & PNG info drops */}
        <div className="gallery-pane glass-panel">
          <div className="gallery-header-row">
            <h3 className="section-title"><ImageIcon size={16} /> Image Gallery ({gallery.length})</h3>
            
            {/* PNG Info Dropzone */}
            <div className="png-info-selector">
              <label className="btn btn-secondary btn-small" htmlFor="png-info-upload">
                <Info size={12} style={{ marginRight: '4px' }} /> Inspect PNG Metadata
              </label>
              <input 
                type="file" 
                id="png-info-upload"
                accept="image/png"
                style={{ display: 'none' }}
                onChange={handlePngFileSelect}
              />
            </div>
          </div>

          {/* Render PNG Info metadata card if parsed */}
          {pngInfoParams && (
            <div className="png-info-result-card border-panel fade-in">
              <div className="card-header">
                <h4><Info size={14} /> PNG Metadata: <span>{pngInfoFilename}</span></h4>
                <button className="btn btn-icon" onClick={() => setPngInfoParams(null)}><X size={14} /></button>
              </div>
              <div className="card-body">
                <div className="metadata-scroll">
                  <p><strong>Positive:</strong> {pngInfoParams.positivePrompt || '(None)'}</p>
                  <p><strong>Negative:</strong> {pngInfoParams.negativePrompt || '(None)'}</p>
                  <p><strong>Model:</strong> {pngInfoParams.checkpoint || '(Unknown)'}</p>
                  <p><strong>Config:</strong> Seed: {pngInfoParams.seed}, Steps: {pngInfoParams.steps}, CFG: {pngInfoParams.cfg}, Sampler: {pngInfoParams.sampler}, Scheduler: {pngInfoParams.scheduler}, Size: {pngInfoParams.width}x{pngInfoParams.height}</p>
                </div>
                <button className="btn btn-primary btn-small btn-load-png" onClick={handleLoadPngInfoParams}>
                  <ArrowRight size={12} /> Load Metadata to Editor
                </button>
              </div>
            </div>
          )}

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
