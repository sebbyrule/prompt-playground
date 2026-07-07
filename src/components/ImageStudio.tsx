import React, { useState, useEffect, useRef } from 'react';
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
  Info,
  Grid,
  Edit3,
  Edit,
  Brush,
  Wind,
  Bot
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

interface WildcardFile {
  name: string;
  content: string;
}

interface GraphNode {
  id: string;
  type: string;
  title: string;
  inputs: any;
  x: number;
  y: number;
  column: number;
}

// PNG Chunk Parser for extracting ComfyUI parameters
function parsePngMetadata(arrayBuffer: ArrayBuffer): { prompt?: any; workflow?: any } {
  const view = new DataView(arrayBuffer);
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

// Compute topological layouts for custom workflows
function layoutWorkflowNodes(workflow: any): GraphNode[] {
  const nodes: GraphNode[] = [];
  const nodeColumns: { [id: string]: number } = {};
  
  for (const id in workflow) {
    nodeColumns[id] = 0;
  }
  
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    
    for (const id in workflow) {
      const node = workflow[id];
      let maxParentCol = -1;
      
      if (node.inputs) {
        for (const key in node.inputs) {
          const inputVal = node.inputs[key];
          if (Array.isArray(inputVal) && inputVal.length >= 1) {
            const parentId = String(inputVal[0]);
            if (nodeColumns[parentId] !== undefined) {
              maxParentCol = Math.max(maxParentCol, nodeColumns[parentId]);
            }
          }
        }
      }
      
      if (maxParentCol !== -1) {
        const newCol = maxParentCol + 1;
        if (nodeColumns[id] !== newCol) {
          nodeColumns[id] = newCol;
          changed = true;
        }
      }
    }
  }
  
  const columns: { [col: number]: string[] } = {};
  for (const id in workflow) {
    const col = nodeColumns[id];
    if (!columns[col]) columns[col] = [];
    columns[col].push(id);
  }
  
  const colWidth = 240;
  const rowHeight = 130;
  
  for (const colStr in columns) {
    const col = Number(colStr);
    const ids = columns[col];
    ids.forEach((id, rowIdx) => {
      const node = workflow[id];
      nodes.push({
        id,
        type: node.class_type,
        title: node.class_type.replace(/([A-Z])/g, ' $1').trim(),
        inputs: node.inputs,
        x: 50 + col * colWidth,
        y: 50 + rowIdx * rowHeight,
        column: col
      });
    });
  }
  
  return nodes;
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

  // Model configuration presets state
  const [modelPreset, setModelPreset] = useState<string>('sd15');

  // LoRA settings state
  const [loras, setLoras] = useState<{ name: string; strength: number }[]>([]);
  const [lorasList, setLorasList] = useState<string[]>([]);
  const [loraDetails, setLoraDetails] = useState<{ 
    [name: string]: { triggerWords: string[]; previewUrl: string; loading: boolean } 
  }>({});

  // img2img settings state
  const [initialImage, setInitialImage] = useState<string | null>(null);
  const [denoise, setDenoise] = useState<number>(0.6);

  // ControlNet settings state
  const [controlNetEnabled, setControlNetEnabled] = useState<boolean>(false);
  const [controlNetImage, setControlNetImage] = useState<string | null>(null);
  const [controlNetModel, setControlNetModel] = useState<string>('control_v11p_sd15_canny.pth');
  const [controlNetPreprocessor, setControlNetPreprocessor] = useState<string>('canny');
  const [controlNetStrength, setControlNetStrength] = useState<number>(1.0);

  // IP-Adapter settings state
  const [ipAdapterEnabled, setIpAdapterEnabled] = useState<boolean>(false);
  const [ipAdapterImage, setIpAdapterImage] = useState<string | null>(null);
  const [ipAdapterModel, setIpAdapterModel] = useState<string>('ip-adapter_sd15.bin');
  const [ipAdapterWeight, setIpAdapterWeight] = useState<number>(0.8);

  // Aspect ratio presets state
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');

  // PNG Info state
  const [pngInfoParams, setPngInfoParams] = useState<any | null>(null);
  const [pngInfoFilename, setPngInfoFilename] = useState<string>('');

  // Tab views state (Gallery vs Wildcards)
  const [galleryTab, setGalleryTab] = useState<'gallery' | 'wildcards'>('gallery');

  // Wildcards state
  const [wildcards, setWildcards] = useState<WildcardFile[]>([]);
  const [activeWildcard, setActiveWildcard] = useState<WildcardFile | null>(null);
  const [newWildcardName, setNewWildcardName] = useState<string>('');
  const [isEditingWildcard, setIsEditingWildcard] = useState<boolean>(false);

  // X/Y Plot Matrix state
  const [enableXyPlot, setEnableXyPlot] = useState<boolean>(false);
  const [xAxisParam, setXAxisParam] = useState<string>('cfg');
  const [xAxisValues, setXAxisValues] = useState<string>('6, 8, 10');
  const [yAxisParam, setYAxisParam] = useState<string>('steps');
  const [yAxisValues, setYAxisValues] = useState<string>('15, 25');
  const [matrixResults, setMatrixResults] = useState<any[][]>([]);
  const [matrixLoading, setMatrixLoading] = useState<boolean>(false);
  const [matrixProgress, setMatrixProgress] = useState<string>('');
  const [showMatrixOverlay, setShowMatrixOverlay] = useState<boolean>(false);

  // SVG Custom Workflow graph viewer state
  const [showWorkflowGraph, setShowWorkflowGraph] = useState<boolean>(false);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphConnections, setGraphConnections] = useState<any[]>([]);

  // HTML5 Image Editor Canvas state
  const [showCanvasEditor, setShowCanvasEditor] = useState<boolean>(false);
  const [canvasImageItem, setCanvasImageItem] = useState<GalleryItem | null>(null);
  const [canvasTool, setCanvasTool] = useState<'brush' | 'eraser' | 'mask'>('brush');
  const [brushColor, setBrushColor] = useState<string>('#a78bfa');
  const [brushSize, setBrushSize] = useState<number>(10);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [saturate, setSaturate] = useState<number>(100);
  const [blur, setBlur] = useState<number>(0);

  // Gallery state
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<GalleryItem | null>(null);

  // Status/Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [checkpointsLoading, setCheckpointsLoading] = useState<boolean>(false);

  // Copilot Assistant State
  const [showCopilot, setShowCopilot] = useState<boolean>(false);
  const [copilotIdea, setCopilotIdea] = useState<string>('');
  const [copilotStyle, setCopilotStyle] = useState<string>('none');
  const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
  const [copilotResult, setCopilotResult] = useState<any | null>(null);

  // Canvas Refs
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Constants
  const samplers = [
    'euler', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral', 
    'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 
    'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 
    'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddim', 'uni_pc'
  ];
  const schedulers = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'];
  const dimensions = [512, 768, 1024];

  const controlNetModels = [
    'control_v11p_sd15_canny.pth',
    'control_v11f1p_sd15_depth.pth',
    'control_v11p_sd15_openpose.pth',
    'control_v11p_sd15_scribble.pth'
  ];

  const ipAdapterModels = [
    'ip-adapter_sd15.bin',
    'ip-adapter_sd15_plus.bin',
    'ip-adapter_sdxl.bin'
  ];

  useEffect(() => {
    fetchPrompts();
    fetchGallery();
    fetchCheckpoints();
    fetchLoras();
    fetchWildcards();
  }, []);

  // Initialize and load canvas image
  useEffect(() => {
    if (showCanvasEditor && canvasImageItem) {
      setTimeout(() => {
        const mainCanvas = mainCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (!mainCanvas || !maskCanvas) return;

        const mainCtx = mainCanvas.getContext('2d');
        const maskCtx = maskCanvas.getContext('2d');
        if (!mainCtx || !maskCtx) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = canvasImageItem.imagePath;
        img.onload = () => {
          mainCanvas.width = img.width;
          mainCanvas.height = img.height;
          maskCanvas.width = img.width;
          maskCanvas.height = img.height;

          // Apply adjustment filters
          mainCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%) blur(${blur}px)`;
          mainCtx.drawImage(img, 0, 0);
          mainCtx.filter = 'none';

          // Clear mask transparency
          maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        };
      }, 100);
    }
  }, [showCanvasEditor, canvasImageItem, brightness, contrast, saturate, blur]);

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

  const fetchLoraDetails = async (loraName: string) => {
    if (loraDetails[loraName]) return;
    
    setLoraDetails(prev => ({
      ...prev,
      [loraName]: { triggerWords: [], previewUrl: '', loading: true }
    }));

    try {
      const res = await api.get(`/api/image-studio/lora-details?name=${encodeURIComponent(loraName)}`);
      setLoraDetails(prev => ({
        ...prev,
        [loraName]: {
          triggerWords: res.triggerWords || [],
          previewUrl: res.previewUrl || '',
          loading: false
        }
      }));
    } catch (e) {
      setLoraDetails(prev => ({
        ...prev,
        [loraName]: { triggerWords: [], previewUrl: '', loading: false }
      }));
    }
  };

  const fetchWildcards = async () => {
    try {
      const data = await api.get('/api/image-studio/wildcards');
      setWildcards(data);
    } catch (err: any) {
      console.warn('Could not retrieve wildcards list:', err.message);
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

  const handleApplyPreset = (preset: string) => {
    setModelPreset(preset);
    switch (preset) {
      case 'sd15':
        setWidth(512);
        setHeight(512);
        setSteps(20);
        setCfg(7.5);
        setSampler('euler');
        setScheduler('normal');
        setNegativePrompt('embedding:easynegative, deformed, bad eyes, blurry, low contrast, duplicate, draft');
        break;
      case 'sdxl':
        setWidth(1024);
        setHeight(1024);
        setSteps(25);
        setCfg(8.0);
        setSampler('dpmpp_2m_sde');
        setScheduler('karras');
        setNegativePrompt('deformed, bad eyes, blurry, duplicate, draft');
        break;
      case 'flux':
        setWidth(1024);
        setHeight(1024);
        setSteps(20);
        setCfg(1.0); // Flux Guidance 3.5 is mapped at model loader weights
        setSampler('euler');
        setScheduler('simple');
        setNegativePrompt(''); // Flux ignores negatives
        break;
      case 'krea':
        setWidth(1024);
        setHeight(768);
        setSteps(30);
        setCfg(7.0);
        setSampler('uni_pc');
        setScheduler('normal');
        break;
      case 'qwen':
        setWidth(512);
        setHeight(512);
        setSteps(15);
        setCfg(5.0);
        setSampler('euler');
        setScheduler('normal');
        break;
      default:
        break;
    }
    showStatus(`Preset "${preset.toUpperCase()}" settings snap applied!`, 'success');
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
      denoise: initialImage ? denoise : undefined,
      
      // ControlNet Parameters
      controlNetEnabled,
      controlNetImage: controlNetEnabled ? controlNetImage : undefined,
      controlNetModel: controlNetEnabled ? controlNetModel : undefined,
      controlNetPreprocessor: controlNetEnabled ? controlNetPreprocessor : undefined,
      controlNetStrength: controlNetEnabled ? controlNetStrength : undefined,

      // IP-Adapter Parameters
      ipAdapterEnabled,
      ipAdapterImage: ipAdapterEnabled ? ipAdapterImage : undefined,
      ipAdapterModel: ipAdapterEnabled ? ipAdapterModel : undefined,
      ipAdapterWeight: ipAdapterEnabled ? ipAdapterWeight : undefined
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
    const targetLora = lorasList[0];
    setLoras([...loras, { name: targetLora, strength: 1.0 }]);
    fetchLoraDetails(targetLora);
  };

  const handleRemoveLora = (index: number) => {
    setLoras(loras.filter((_, idx) => idx !== index));
  };

  const handleLoraChange = (index: number, field: 'name' | 'strength', value: any) => {
    const updated = [...loras];
    if (field === 'name') {
      updated[index].name = value;
      fetchLoraDetails(value);
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

  // ControlNet Guide Image Uploader
  const handleControlNetImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      setControlNetImage(event.target?.result as string);
      showStatus('ControlNet image guide loaded!', 'success');
    };
    reader.readAsDataURL(file);
  };

  const handleClearControlNetImage = () => {
    setControlNetImage(null);
    showStatus('ControlNet reference image cleared.', 'info');
  };

  // Sobel Filter Preprocessor edge previewer
  const handlePreviewControlNetMap = () => {
    if (!controlNetImage) {
      showStatus('Please upload a ControlNet reference image first.', 'error');
      return;
    }
    showStatus('Preprocessing control image locally...', 'info');

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = controlNetImage;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      const width = canvas.width;
      const height = canvas.height;
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      const edges = new Uint8Array(width * height);
      const gx = [
        -1, 0, 1,
        -2, 0, 2,
        -1, 0, 1
      ];
      const gy = [
        -1, -2, -1,
         0,  0,  0,
         1,  2,  1
      ];

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let valX = 0;
          let valY = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const pixel = gray[(y + ky) * width + (x + kx)];
              valX += pixel * gx[(ky + 1) * 3 + (kx + 1)];
              valY += pixel * gy[(ky + 1) * 3 + (kx + 1)];
            }
          }
          const magnitude = Math.sqrt(valX * valX + valY * valY);
          edges[y * width + x] = magnitude > 50 ? 255 : 0;
        }
      }

      for (let i = 0; i < data.length; i += 4) {
        const val = edges[i / 4];
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      setControlNetImage(canvas.toDataURL('image/png'));
      showStatus('Sobel edges preprocessor map applied!', 'success');
    };
  };

  // IP-Adapter style reference Image Uploader
  const handleIpAdapterImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      setIpAdapterImage(event.target?.result as string);
      showStatus('IP-Adapter style reference image loaded!', 'success');
    };
    reader.readAsDataURL(file);
  };

  const handleClearIpAdapterImage = () => {
    setIpAdapterImage(null);
    showStatus('IP-Adapter reference image cleared.', 'info');
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

  // Wildcards Management Handlers
  const handleSaveWildcard = async () => {
    if (!activeWildcard) return;
    try {
      await api.post(`/api/image-studio/wildcards/${activeWildcard.name}`, { content: activeWildcard.content });
      showStatus(`Wildcard __${activeWildcard.name}__ updated successfully!`, 'success');
      await fetchWildcards();
      setIsEditingWildcard(false);
    } catch (err: any) {
      showStatus('Failed to update wildcard: ' + err.message, 'error');
    }
  };

  const handleCreateWildcard = async () => {
    const name = newWildcardName.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!name) {
      showStatus('Invalid name. Use alphanumeric characters only.', 'error');
      return;
    }
    try {
      await api.post(`/api/image-studio/wildcards/${name}`, { content: '' });
      setNewWildcardName('');
      showStatus(`Wildcard __${name}__ created!`, 'success');
      await fetchWildcards();
      setActiveWildcard({ name, content: '' });
      setIsEditingWildcard(true);
    } catch (err: any) {
      showStatus('Failed to create wildcard: ' + err.message, 'error');
    }
  };

  const handleDeleteWildcard = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete __${name}__?`)) return;
    try {
      await api.delete(`/api/image-studio/wildcards/${name}`);
      showStatus(`Wildcard __${name}__ deleted.`, 'success');
      await fetchWildcards();
      if (activeWildcard?.name === name) {
        setActiveWildcard(null);
        setIsEditingWildcard(false);
      }
    } catch (err: any) {
      showStatus('Failed to delete wildcard: ' + err.message, 'error');
    }
  };

  // X/Y Plot generation runner
  const handleGenerateMatrix = async () => {
    const xVals = xAxisValues.split(',').map(v => v.trim()).filter(Boolean);
    const yVals = yAxisParam === 'none' ? [''] : yAxisValues.split(',').map(v => v.trim()).filter(Boolean);
    
    if (xVals.length === 0) {
      showStatus('X-axis values cannot be empty.', 'error');
      return;
    }
    if (yAxisParam !== 'none' && yVals.length === 0) {
      showStatus('Y-axis values cannot be empty.', 'error');
      return;
    }

    setMatrixLoading(true);
    setShowMatrixOverlay(true);
    setMatrixProgress(`Initializing matrix (0/${xVals.length * yVals.length})...`);
    
    const grid: any[][] = [];
    for (let y = 0; y < yVals.length; y++) {
      grid[y] = [];
      for (let x = 0; x < xVals.length; x++) {
        grid[y][x] = {
          xVal: xVals[x],
          yVal: yVals[y],
          imagePath: '',
          loading: true,
          error: null
        };
      }
    }
    setMatrixResults(grid);

    let completed = 0;
    const total = xVals.length * yVals.length;

    for (let y = 0; y < yVals.length; y++) {
      for (let x = 0; x < xVals.length; x++) {
        const xVal = xVals[x];
        const yVal = yVals[y];
        setMatrixProgress(`Generating combination ${completed + 1} of ${total}: [X=${xVal}, Y=${yVal || 'N/A'}]...`);

        const activeParams = {
          positivePrompt,
          negativePrompt,
          checkpoint: checkpoint || checkpointsList[0],
          width,
          height,
          steps,
          cfg,
          sampler,
          scheduler,
          seed: randomizeSeed ? Math.floor(Math.random() * 1000000000) : seed,
          loras,
          initialImage: initialImage || undefined,
          denoise: initialImage ? denoise : undefined
        };

        const applyOverride = (param: string, value: string) => {
          if (param === 'checkpoint') activeParams.checkpoint = value;
          else if (param === 'steps') activeParams.steps = Number(value);
          else if (param === 'cfg') activeParams.cfg = Number(value);
          else if (param === 'sampler') activeParams.sampler = value;
          else if (param === 'seed') {
            activeParams.seed = Number(value);
          }
          else if (param === 'positive_prompt') activeParams.positivePrompt = value;
        };

        applyOverride(xAxisParam, xVal);
        if (yAxisParam !== 'none') {
          applyOverride(yAxisParam, yVal);
        }

        try {
          const res = await api.post('/api/image-studio/generate', activeParams);
          if (res.items && res.items.length > 0) {
            grid[y][x] = {
              xVal,
              yVal,
              imagePath: res.items[0].imagePath,
              loading: false,
              error: null,
              seed: res.items[0].seed,
              item: res.items[0]
            };
          } else {
            throw new Error('ComfyUI returned no output image');
          }
        } catch (err: any) {
          grid[y][x] = {
            xVal,
            yVal,
            imagePath: '',
            loading: false,
            error: err.message
          };
        }

        setMatrixResults([...grid]);
        completed++;
        setMatrixProgress(`Generating combination ${completed} of ${total}...`);
      }
    }

    setMatrixLoading(false);
    showStatus('Matrix generated successfully!', 'success');
    fetchGallery();
  };

  // Image Copilot Runner
  const handleRunCopilot = async (taskType: 'prompt' | 'workflow') => {
    if (!copilotIdea.trim()) {
      showStatus('Please specify an idea/topic for the Copilot.', 'error');
      return;
    }
    setCopilotLoading(true);
    setCopilotResult(null);
    showStatus('Querying Copilot model...', 'info');

    const activeModel = localStorage.getItem('copilot_selected_model') || 'gemini-1.5-flash';

    try {
      const res = await api.post('/api/image-studio/copilot', {
        taskType,
        userIdea: copilotIdea,
        artStyle: copilotStyle !== 'none' ? copilotStyle : undefined,
        model: activeModel
      });
      setCopilotResult({ type: taskType, ...res });
      showStatus('Copilot resolved successfully!', 'success');
    } catch (err: any) {
      showStatus('Copilot failed: ' + err.message, 'error');
    } finally {
      setCopilotLoading(false);
    }
  };

  // SVG workflow diagram modal trigger
  const handleOpenWorkflowGraph = () => {
    try {
      const parsed = JSON.parse(customWorkflow);
      const nodes = layoutWorkflowNodes(parsed);
      
      // Calculate connections mapping
      const connections: any[] = [];
      nodes.forEach(node => {
        if (node.inputs) {
          for (const key in node.inputs) {
            const inputVal = node.inputs[key];
            if (Array.isArray(inputVal) && inputVal.length >= 1) {
              const parentId = String(inputVal[0]);
              const outputIdx = inputVal[1];
              connections.push({
                fromId: parentId,
                fromOutput: outputIdx,
                toId: node.id,
                toInput: key
              });
            }
          }
        }
      });

      setGraphNodes(nodes);
      setGraphConnections(connections);
      setShowWorkflowGraph(true);
    } catch (e: any) {
      showStatus('Invalid Workflow JSON: ' + e.message, 'error');
    }
  };

  // Drawing Handlers
  const handleDrawingStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas) return;
    
    setIsDrawing(true);
    const rect = mainCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * mainCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * mainCanvas.height;
    setLastPos({ x, y });
  };

  const handleDrawingMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    
    const mainCanvas = mainCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!mainCanvas || !maskCanvas) return;

    const mainCtx = mainCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!mainCtx || !maskCtx) return;

    const rect = mainCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * mainCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * mainCanvas.height;

    const activeCtx = canvasTool === 'mask' ? maskCtx : mainCtx;
    activeCtx.beginPath();
    activeCtx.moveTo(lastPos.x, lastPos.y);
    activeCtx.lineTo(x, y);

    if (canvasTool === 'eraser') {
      activeCtx.globalCompositeOperation = 'destination-out';
      activeCtx.lineWidth = brushSize;
      activeCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (canvasTool === 'mask') {
      activeCtx.globalCompositeOperation = 'source-over';
      activeCtx.lineWidth = brushSize;
      activeCtx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; // semi transparent red
    } else {
      activeCtx.globalCompositeOperation = 'source-over';
      activeCtx.lineWidth = brushSize;
      activeCtx.strokeStyle = brushColor;
    }
    
    activeCtx.lineCap = 'round';
    activeCtx.lineJoin = 'round';
    activeCtx.stroke();

    setLastPos({ x, y });
  };

  const handleDrawingEnd = () => {
    setIsDrawing(false);
  };

  // Export Drawing Canvas
  const handleSaveCanvasEdited = async () => {
    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas || !canvasImageItem) return;

    setIsLoading(true);
    showStatus('Saving edited image to gallery...', 'info');

    const dataUrl = mainCanvas.toDataURL('image/png');

    try {
      const res = await api.post('/api/image-studio/gallery/save-edited', {
        imageData: dataUrl,
        promptName: `Canvas: ${canvasImageItem.promptName}`,
        positivePrompt: canvasImageItem.positivePrompt,
        negativePrompt: canvasImageItem.negativePrompt,
        checkpoint: canvasImageItem.checkpoint,
        width: mainCanvas.width,
        height: mainCanvas.height,
        steps: canvasImageItem.steps,
        cfg: canvasImageItem.cfg,
        sampler: canvasImageItem.sampler,
        scheduler: canvasImageItem.scheduler,
        seed: canvasImageItem.seed
      });
      showStatus('Edited image saved as new history entry!', 'success');
      setShowCanvasEditor(false);
      setSelectedImage(res);
      await fetchGallery();
    } catch (err: any) {
      showStatus('Failed to save edited canvas: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseCanvasAsImg2Img = () => {
    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas) return;
    const dataUrl = mainCanvas.toDataURL('image/png');
    setInitialImage(dataUrl);
    setShowCanvasEditor(false);
    showStatus('Canvas image loaded as img2img source target!', 'success');
  };

  // Convert Mask paths to pure Black & White binary inpaint mask file
  const handleDownloadInpaintMask = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskCanvas.width;
    tempCanvas.height = maskCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    // Background Black
    tempCtx.fillStyle = '#000000';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw painted mask strokes on top as pure White
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const data = imgData.data;
      
      const tempImgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const tempData = tempImgData.data;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) { // If painted mask stroke exists
          tempData[i] = 255;   // Red
          tempData[i + 1] = 255; // Green
          tempData[i + 2] = 255; // Blue
          tempData[i + 3] = 255; // Alpha
        }
      }
      tempCtx.putImageData(tempImgData, 0, 0);
    }

    // Trigger download
    const dataUrl = tempCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `mask_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    showStatus('Black & white inpaint mask downloaded!', 'success');
  };

  const handleResetFilters = () => {
    setBrightness(100);
    setContrast(100);
    setSaturate(100);
    setBlur(0);
    showStatus('Filters reset.', 'info');
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
            
            {/* Model configuration preset select */}
            <div className="form-group">
              <label>Model Engine / Preset</label>
              <select value={modelPreset} onChange={(e) => handleApplyPreset(e.target.value)}>
                <option value="sd15">Stable Diffusion v1.5 (Standard)</option>
                <option value="sdxl">Stable Diffusion XL (High Def)</option>
                <option value="flux">FLUX.1 (Pro Quality)</option>
                <option value="krea">Krea AI Creative Style</option>
                <option value="qwen">Qwen Image Edit (Pix2Pix)</option>
              </select>
            </div>

            {/* Prompt Selector */}
            <div className="form-row flex-gap" style={{ marginTop: '12px' }}>
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
            {/* Copilot Prompt & Workflow Assistant */}
            <div className="form-group border-panel copilot-assistant-section">
              <div className="toggle-row" style={{ justifyContent: 'space-between' }}>
                <span className="toggle-row-label" style={{ fontWeight: 600, fontSize: '13px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bot size={16} /> Copilot AI Assistant
                </span>
                <button 
                  className="btn btn-secondary btn-small"
                  onClick={() => setShowCopilot(!showCopilot)}
                >
                  {showCopilot ? 'Hide' : 'Expand'}
                </button>
              </div>

              {showCopilot && (
                <div className="copilot-expanded-content fade-in" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Describe your design goal</label>
                    <input 
                      type="text" 
                      placeholder="e.g. A gorgeous watercolor fantasy cottage in mountains..."
                      value={copilotIdea}
                      onChange={(e) => setCopilotIdea(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Artistic Style Modifier</label>
                    <select value={copilotStyle} onChange={(e) => setCopilotStyle(e.target.value)}>
                      <option value="none">-- None (Raw Expansion) --</option>
                      <option value="Cinematic Portrait (volumetric lighting, highly detailed 8k photography, 85mm lens)">Cinematic Portrait</option>
                      <option value="Vaporwave Anime Style (neon pastel colors, retro 90s aesthetic, cel shaded)">Vaporwave Anime</option>
                      <option value="Watercolor Fantasy (soft paint washes, ink sketch outlines, whimsical vibe)">Watercolor Fantasy</option>
                      <option value="Cyberpunk Cityscape (neon glowing signage, wet rainy asphalt, dark cinematic ambiance)">Cyberpunk Cityscape</option>
                      <option value="Photorealistic Landscape (natural morning sunshine, high dynamic range, detailed textures)">Photorealistic Landscape</option>
                      <option value="3D Game Render (Unreal Engine 5 style, octane render, stylized digital art)">3D Game Render</option>
                    </select>
                  </div>

                  <div className="form-row flex-gap" style={{ marginBottom: 0 }}>
                    <button 
                      className="btn btn-secondary flex-1 btn-small"
                      onClick={() => handleRunCopilot('prompt')}
                      disabled={copilotLoading}
                    >
                      {copilotLoading ? <Loader2 className="spinning" size={12} /> : 'Expand Prompt'}
                    </button>
                    <button 
                      className="btn btn-secondary flex-1 btn-small"
                      onClick={() => handleRunCopilot('workflow')}
                      disabled={copilotLoading}
                    >
                      {copilotLoading ? <Loader2 className="spinning" size={12} /> : 'Generate Workflow'}
                    </button>
                  </div>

                  {copilotResult && (
                    <div className="copilot-result-box border-panel fade-in" style={{ marginTop: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-primary)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                        AI Suggestion
                      </span>
                      {copilotResult.type === 'prompt' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '12px', maxHeight: '100px', overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px', lineHeight: '1.4' }}>
                            <strong>Positive:</strong> {copilotResult.positivePrompt}
                          </div>
                          <button 
                            className="btn btn-primary btn-small"
                            onClick={() => {
                              setPositivePrompt(copilotResult.positivePrompt);
                              if (copilotResult.negativePrompt) {
                                setNegativePrompt(copilotResult.negativePrompt);
                              }
                              setCopilotResult(null);
                              showStatus('Copilot prompt applied!', 'success');
                            }}
                          >
                            Apply Prompt
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '11px', fontFamily: 'monospace', maxHeight: '100px', overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px', color: '#a7f3d0' }}>
                            {JSON.stringify(copilotResult.workflow).substr(0, 150)}...
                          </div>
                          <button 
                            className="btn btn-primary btn-small"
                            onClick={() => {
                              setUseCustomWorkflow(true);
                              setCustomWorkflow(JSON.stringify(copilotResult.workflow, null, 2));
                              setCopilotResult(null);
                              showStatus('Copilot workflow applied!', 'success');
                            }}
                          >
                            Apply Custom Workflow
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Checkpoint Loader */}
            <div className="form-group" style={{ marginTop: '14px' }}>
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
              <small className="help-text">Use wildcards like `__clothing__` or `__style__` to pick random choices.</small>
            </div>

            {/* Negative Prompt */}
            {modelPreset !== 'flux' && (
              <div className="form-group fade-in">
                <label>Negative Prompt</label>
                <textarea 
                  className="prompt-textarea negative" 
                  placeholder="ugly, deformed, bad quality..."
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                />
              </div>
            )}

            {/* LoRAs Section */}
            <div className="form-group loras-section">
              <div className="section-header-row">
                <label>LoRAs ({loras.length})</label>
                <button className="btn btn-secondary btn-small" onClick={handleAddLora}><Plus size={12} /> Add LoRA</button>
              </div>
              {loras.length > 0 && (
                <div className="loras-list-container">
                  {loras.map((lora, index) => {
                    const details = loraDetails[lora.name];
                    return (
                      <div key={index} className="lora-row border-panel" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <select 
                            value={lora.name}
                            onChange={(e) => handleLoraChange(index, 'name', e.target.value)}
                            className="lora-select"
                            style={{ flex: 1 }}
                          >
                            {lorasList.map(l => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <button className="btn btn-icon btn-danger-hover" onClick={() => handleRemoveLora(index)}>
                            <X size={12} />
                          </button>
                        </div>

                        <div className="lora-weight-control" style={{ marginTop: '8px' }}>
                          <input 
                            type="range" 
                            min={0.0} 
                            max={1.5} 
                            step={0.05} 
                            value={lora.strength} 
                            onChange={(e) => handleLoraChange(index, 'strength', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <span className="weight-badge">{lora.strength.toFixed(2)}</span>
                        </div>

                        {/* LoRA Previews and click-to-add trigger words */}
                        {details && (
                          <div className="lora-details-badge fade-in" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', display: 'flex', gap: '8px' }}>
                            {details.loading ? (
                              <div className="loader-row" style={{ fontSize: '10px' }}><Loader2 className="spinning" size={10} /> Fetching Civitai words...</div>
                            ) : (
                              <>
                                {details.previewUrl && (
                                  <img 
                                    src={details.previewUrl} 
                                    className="lora-thumbnail-preview" 
                                    alt="LoRA model illustration" 
                                    style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                  />
                                )}
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Trigger Words (Click to add):</span>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {details.triggerWords.length === 0 ? (
                                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>None detected</span>
                                    ) : (
                                      details.triggerWords.slice(0, 6).map(word => (
                                        <button 
                                          key={word}
                                          className="preset-chip btn-small"
                                          style={{ padding: '2px 6px', fontSize: '9px' }}
                                          onClick={() => setPositivePrompt(prev => prev ? `${prev}, ${word}` : word)}
                                        >
                                          {word}
                                        </button>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Aspect Ratio Presets */}
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

            {/* ControlNet Section Accordion */}
            <div className="form-group border-panel xy-plot-config">
              <div className="toggle-row">
                <input 
                  type="checkbox" 
                  id="enable-controlnet" 
                  checked={controlNetEnabled}
                  onChange={(e) => setControlNetEnabled(e.target.checked)}
                />
                <label htmlFor="enable-controlnet"><Grid size={14} style={{ marginRight: '4px' }} /> Enable ControlNet Guidance</label>
              </div>

              {controlNetEnabled && (
                <div className="xy-config-form fade-in" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label>Control Model</label>
                    <select value={controlNetModel} onChange={(e) => setControlNetModel(e.target.value)}>
                      {controlNetModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Preprocessor Outline</label>
                    <select value={controlNetPreprocessor} onChange={(e) => setControlNetPreprocessor(e.target.value)}>
                      <option value="canny">Canny Edges Preprocessor</option>
                      <option value="none">None (Direct upload map)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Control Image Guide</label>
                    {controlNetImage ? (
                      <div className="initial-image-preview-container">
                        <img src={controlNetImage} className="initial-image-thumbnail" alt="ControlNet guide sketch" />
                        <div className="initial-image-controls">
                          <button className="btn btn-secondary btn-small" onClick={handleClearControlNetImage}><X size={12} /> Clear Guide</button>
                          {controlNetPreprocessor === 'canny' && (
                            <button className="btn btn-secondary btn-small" onClick={handlePreviewControlNetMap} style={{ marginTop: '4px' }}>
                              Preview Edges Map
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="img2img-upload-dropzone">
                        <ImageIcon size={24} className="upload-icon" />
                        <span>Upload outline / sketch guide</span>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={handleControlNetImageUpload}
                        />
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <div className="denoise-slider-container">
                      <label className="denoise-label">Control Strength: <span>{controlNetStrength.toFixed(2)}</span></label>
                      <input 
                        type="range" 
                        min={0.0} 
                        max={2.0} 
                        step={0.05} 
                        value={controlNetStrength} 
                        onChange={(e) => setControlNetStrength(Number(e.target.value))} 
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* IP-Adapter Style Transfer Section Accordion */}
            <div className="form-group border-panel xy-plot-config">
              <div className="toggle-row">
                <input 
                  type="checkbox" 
                  id="enable-ipadapter" 
                  checked={ipAdapterEnabled}
                  onChange={(e) => setIpAdapterEnabled(e.target.checked)}
                />
                <label htmlFor="enable-ipadapter"><Wind size={14} style={{ marginRight: '4px' }} /> Enable IP-Adapter Style Reference</label>
              </div>

              {ipAdapterEnabled && (
                <div className="xy-config-form fade-in" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label>Style Model</label>
                    <select value={ipAdapterModel} onChange={(e) => setIpAdapterModel(e.target.value)}>
                      {ipAdapterModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Style Reference Image</label>
                    {ipAdapterImage ? (
                      <div className="initial-image-preview-container">
                        <img src={ipAdapterImage} className="initial-image-thumbnail" alt="IP-Adapter style input" />
                        <div className="initial-image-controls">
                          <button className="btn btn-secondary btn-small" onClick={handleClearIpAdapterImage}><X size={12} /> Clear Reference</button>
                        </div>
                      </div>
                    ) : (
                      <div className="img2img-upload-dropzone">
                        <ImageIcon size={24} className="upload-icon" />
                        <span>Upload style / concept image</span>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={handleIpAdapterImageUpload}
                        />
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <div className="denoise-slider-container">
                      <label className="denoise-label">Influence Weight: <span>{ipAdapterWeight.toFixed(2)}</span></label>
                      <input 
                        type="range" 
                        min={0.0} 
                        max={1.5} 
                        step={0.05} 
                        value={ipAdapterWeight} 
                        onChange={(e) => setIpAdapterWeight(Number(e.target.value))} 
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* X/Y Plot Configurator Section */}
            <div className="form-group border-panel xy-plot-config">
              <div className="toggle-row">
                <input 
                  type="checkbox" 
                  id="enable-xy" 
                  checked={enableXyPlot}
                  onChange={(e) => setEnableXyPlot(e.target.checked)}
                />
                <label htmlFor="enable-xy"><Grid size={14} style={{ marginRight: '4px' }} /> Enable X/Y Plot Grid Matrix</label>
              </div>

              {enableXyPlot && (
                <div className="xy-config-form fade-in" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label>X-Axis Parameter</label>
                    <select value={xAxisParam} onChange={(e) => setXAxisParam(e.target.value)}>
                      <option value="cfg">CFG Scale</option>
                      <option value="steps">Steps</option>
                      <option value="checkpoint">Checkpoint</option>
                      <option value="sampler">Sampler</option>
                      <option value="seed">Seed</option>
                      <option value="positive_prompt">Positive Prompt</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>X-Axis Values (comma separated)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 6, 8, 10" 
                      value={xAxisValues} 
                      onChange={(e) => setXAxisValues(e.target.value)} 
                    />
                  </div>

                  <div className="form-group border-top" style={{ paddingTop: '10px', marginTop: '6px' }}>
                    <label>Y-Axis Parameter</label>
                    <select value={yAxisParam} onChange={(e) => setYAxisParam(e.target.value)}>
                      <option value="none">-- None (1D Plot) --</option>
                      <option value="cfg">CFG Scale</option>
                      <option value="steps">Steps</option>
                      <option value="checkpoint">Checkpoint</option>
                      <option value="sampler">Sampler</option>
                      <option value="seed">Seed</option>
                      <option value="positive_prompt">Positive Prompt</option>
                    </select>
                  </div>
                  {yAxisParam !== 'none' && (
                    <div className="form-group">
                      <label>Y-Axis Values (comma separated)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 15, 25" 
                        value={yAxisValues} 
                        onChange={(e) => setYAxisValues(e.target.value)} 
                      />
                    </div>
                  )}
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
                <div className="section-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Custom ComfyUI API JSON</label>
                  <button className="btn btn-secondary btn-small" onClick={handleOpenWorkflowGraph}><Wind size={12} /> View Graph</button>
                </div>
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
                {!enableXyPlot && (
                  <>
                    <div className="form-row flex-gap">
                      <div className="form-group flex-1">
                        <label>Steps</label>
                        <input type="number" min={1} max={150} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
                      </div>
                      {modelPreset !== 'flux' && (
                        <div className="form-group flex-1">
                          <label>CFG Scale</label>
                          <input type="number" min={1} max={30} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} />
                        </div>
                      )}
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
              </>
            )}

            {/* Seed */}
            {!enableXyPlot && (
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
            )}
          </div>

          {/* Action Row */}
          <div className="pane-section form-actions-row">
            {statusMessage && statusMessage.type === 'info' && (
              <div className="progress-banner">
                <Loader2 className="spinning" size={16} />
                <span>{statusMessage.text}</span>
              </div>
            )}
            
            {enableXyPlot ? (
              <button 
                className="btn btn-primary btn-generate" 
                onClick={handleGenerateMatrix}
                disabled={matrixLoading}
              >
                {matrixLoading ? (
                  <>
                    <Loader2 className="spinning" size={18} />
                    Running Matrix...
                  </>
                ) : (
                  <>
                    <Grid size={18} />
                    Generate X/Y Matrix
                  </>
                )}
              </button>
            ) : (
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
            )}
          </div>
        </div>

        {/* Right Side: Tab switcher for Gallery vs Wildcard Manager */}
        <div className="gallery-pane glass-panel">
          <div className="gallery-header-row">
            <div className="tab-buttons-container">
              <button 
                className={`tab-btn ${galleryTab === 'gallery' ? 'active' : ''}`}
                onClick={() => setGalleryTab('gallery')}
              >
                <ImageIcon size={14} /> Gallery ({gallery.length})
              </button>
              <button 
                className={`tab-btn ${galleryTab === 'wildcards' ? 'active' : ''}`}
                onClick={() => setGalleryTab('wildcards')}
              >
                <Edit3 size={14} /> Wildcards ({wildcards.length})
              </button>
            </div>
            
            {galleryTab === 'gallery' && (
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
            )}
          </div>

          {galleryTab === 'gallery' ? (
            <>
              {/* PNG Info details card */}
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
            </>
          ) : (
            // Wildcard Manager Workspace
            <div className="wildcards-tab-container fade-in">
              <div className="wildcards-grid-layout">
                {/* Wildcard Files List */}
                <div className="wildcards-sidebar border-right">
                  <div className="form-row flex-gap align-end" style={{ marginBottom: '16px' }}>
                    <div className="form-group flex-1" style={{ marginBottom: 0 }}>
                      <label>Create New Wildcard</label>
                      <input 
                        type="text" 
                        placeholder="e.g. clothing"
                        value={newWildcardName}
                        onChange={(e) => setNewWildcardName(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-secondary btn-small" onClick={handleCreateWildcard}>
                      <Plus size={14} /> Create
                    </button>
                  </div>

                  <div className="wildcard-items-list">
                    {wildcards.length === 0 && <div className="loader-row">No wildcards created yet.</div>}
                    {wildcards.map(w => (
                      <div 
                        key={w.name}
                        className={`wildcard-item ${activeWildcard?.name === w.name ? 'active' : ''}`}
                        onClick={() => {
                          setActiveWildcard(w);
                          setIsEditingWildcard(true);
                        }}
                      >
                        <span>__{w.name}__</span>
                        <button className="btn-delete-card" onClick={(e) => handleDeleteWildcard(w.name, e)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Wildcard Editor Pane */}
                <div className="wildcards-editor-pane">
                  {isEditingWildcard && activeWildcard ? (
                    <div className="wildcard-text-editor fade-in">
                      <div className="editor-header">
                        <h4>Editing: __{activeWildcard.name}__</h4>
                        <div className="flex-gap">
                          <button className="btn btn-secondary btn-small" onClick={() => setIsEditingWildcard(false)}>Cancel</button>
                          <button className="btn btn-primary btn-small" onClick={handleSaveWildcard}>Save Changes</button>
                        </div>
                      </div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        Enter choice items (one item per line). Lines starting with `#` are ignored.
                      </label>
                      <textarea 
                        className="wildcard-textarea-input"
                        placeholder="red shirt&#10;blue dress&#10;green jacket"
                        value={activeWildcard.content}
                        onChange={(e) => setActiveWildcard({ ...activeWildcard, content: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="editor-placeholder">
                      <Edit3 size={48} className="empty-icon" />
                      <h4>Wildcard Library</h4>
                      <p>Select a wildcard file from the sidebar list to edit its options, or create a new one. Reference them in prompts as `__filename__`.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SVG Workflow Node Graph Modal Overlay */}
      {showWorkflowGraph && (
        <div className="modal-backdrop graph-modal-backdrop" onClick={() => setShowWorkflowGraph(false)}>
          <div className="modal-content graph-modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowWorkflowGraph(false)}><X size={20} /></button>
            
            <div className="graph-viewer-header border-bottom" style={{ padding: '16px 24px' }}>
              <h3>Workflow Node Graph</h3>
              <p>Visual map of custom ComfyUI workflow pipelines and dependencies.</p>
            </div>

            <div className="graph-svg-wrapper">
              <svg className="workflow-svg" width="100%" height="600" viewBox="0 0 1600 800">
                <defs>
                  <linearGradient id="nodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(30, 27, 75, 0.95)" />
                    <stop offset="100%" stopColor="rgba(15, 23, 42, 0.95)" />
                  </linearGradient>
                  <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="var(--accent-primary)" />
                    <stop offset="100%" stopColor="var(--accent-secondary)" />
                  </linearGradient>
                </defs>

                {/* Draw connections first (rendered behind node cards) */}
                {graphConnections.map((conn, idx) => {
                  const fromNode = graphNodes.find(n => n.id === conn.fromId);
                  const toNode = graphNodes.find(n => n.id === conn.toId);
                  if (!fromNode || !toNode) return null;

                  const x1 = fromNode.x + 190;
                  const y1 = fromNode.y + 40;
                  const x2 = toNode.x;
                  const y2 = toNode.y + 45;

                  const cp1x = x1 + 60;
                  const cp1y = y1;
                  const cp2x = x2 - 60;
                  const cp2y = y2;

                  return (
                    <g key={idx}>
                      <path 
                        d={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                        fill="none"
                        stroke="url(#lineGrad)"
                        strokeWidth="2.5"
                        opacity="0.85"
                        strokeDasharray="4, 4"
                      />
                      <circle cx={x1} cy={y1} r="4" fill="var(--accent-primary)" />
                      <circle cx={x2} cy={y2} r="4" fill="var(--accent-secondary)" />
                    </g>
                  );
                })}

                {/* Draw Nodes */}
                {graphNodes.map(node => (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <rect 
                      width="190" 
                      height="85" 
                      rx="8" 
                      fill="url(#nodeGrad)" 
                      stroke="var(--border-color)" 
                      strokeWidth="1.5" 
                      className="graph-node-rect"
                    />
                    {/* Node Header */}
                    <text x="12" y="24" fill="var(--accent-primary)" fontSize="12" fontWeight="700" fontFamily="sans-serif">
                      #{node.id} {node.title}
                    </text>
                    
                    {/* Render input summaries */}
                    <text x="12" y="44" fill="var(--text-secondary)" fontSize="10" fontFamily="sans-serif">
                      Type: {node.type}
                    </text>
                    
                    {node.inputs && node.inputs.seed && (
                      <text x="12" y="60" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">
                        Seed: {String(node.inputs.seed).substr(0, 12)}...
                      </text>
                    )}
                    {node.inputs && node.inputs.ckpt_name && (
                      <text x="12" y="60" fill="var(--text-muted)" fontSize="9" fontFamily="monospace" width="160">
                        Model: {String(node.inputs.ckpt_name).substr(0, 20)}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* X/Y Plot Matrix Overlay View */}
      {showMatrixOverlay && (
        <div className="modal-backdrop matrix-viewer-backdrop" onClick={() => { if (!matrixLoading) setShowMatrixOverlay(false); }}>
          <div className="modal-content matrix-viewer-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowMatrixOverlay(false)} disabled={matrixLoading}><X size={20} /></button>
            
            <div className="matrix-viewer-header border-bottom">
              <h3>X/Y Plot Grid Matrix</h3>
              <p>
                X-Axis: <strong>{xAxisParam}</strong> ({xAxisValues}) | Y-Axis: <strong>{yAxisParam}</strong> ({yAxisParam === 'none' ? 'None' : yAxisValues})
              </p>
              {matrixLoading && (
                <div className="progress-banner matrix-progress">
                  <Loader2 className="spinning" size={16} />
                  <span>{matrixProgress}</span>
                </div>
              )}
            </div>

            <div className="matrix-scroll-wrapper">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th className="corner-hdr">Y \ X</th>
                    {xAxisValues.split(',').map(v => v.trim()).filter(Boolean).map(xVal => (
                      <th key={xVal} className="axis-hdr x-hdr">{xVal}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixResults.map((row, yIdx) => {
                    const yVal = row[0]?.yVal || '';
                    return (
                      <tr key={yIdx}>
                        <td className="axis-hdr y-hdr">{yVal || 'N/A'}</td>
                        {row.map((cell, xIdx) => (
                          <td key={xIdx} className="matrix-cell">
                            {cell.loading ? (
                              <div className="cell-loader">
                                <Loader2 className="spinning" size={24} />
                              </div>
                            ) : cell.error ? (
                              <div className="cell-error">
                                <p>Error</p>
                                <span title={cell.error}>Details</span>
                              </div>
                            ) : (
                              <div className="cell-image-wrapper" onClick={() => setSelectedImage(cell.item)}>
                                <img src={cell.imagePath} alt={`X:${cell.xVal} Y:${cell.yVal}`} />
                                <div className="cell-overlay-tag">
                                  <span>Seed: {cell.seed}</span>
                                </div>
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* HTML5 Image Editor Canvas Modal Overlay */}
      {showCanvasEditor && canvasImageItem && (
        <div className="modal-backdrop canvas-editor-backdrop">
          <div className="modal-content canvas-editor-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCanvasEditor(false)}><X size={20} /></button>
            
            <div className="canvas-editor-header border-bottom">
              <h3>Image Studio Canvas Editor</h3>
              <p>Draw, paint transparent inpaint masks, and adjust color/tone filters.</p>
            </div>

            <div className="canvas-editor-layout">
              {/* Toolbar */}
              <div className="canvas-toolbar border-right">
                <div className="tool-section">
                  <span className="tool-section-title">Draw Tools</span>
                  <div className="btn-stack">
                    <button 
                      className={`btn ${canvasTool === 'brush' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setCanvasTool('brush')}
                    >
                      <Brush size={14} /> Brush
                    </button>
                    <button 
                      className={`btn ${canvasTool === 'mask' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setCanvasTool('mask')}
                    >
                      <Edit size={14} style={{ color: '#ef4444' }} /> Inpaint Mask
                    </button>
                    <button 
                      className={`btn ${canvasTool === 'eraser' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setCanvasTool('eraser')}
                    >
                      <Trash2 size={14} /> Eraser
                    </button>
                  </div>
                </div>

                {canvasTool === 'brush' && (
                  <div className="tool-section">
                    <span className="tool-section-title">Color Picker</span>
                    <input 
                      type="color" 
                      value={brushColor} 
                      onChange={(e) => setBrushColor(e.target.value)}
                      className="canvas-color-input"
                    />
                  </div>
                )}

                <div className="tool-section">
                  <span className="tool-section-title">Brush Size: {brushSize}px</span>
                  <input 
                    type="range" 
                    min="1" 
                    max="50" 
                    value={brushSize} 
                    onChange={(e) => setBrushSize(Number(e.target.value))} 
                  />
                </div>

                {/* Filters */}
                <div className="tool-section border-top" style={{ paddingTop: '12px' }}>
                  <span className="tool-section-title">Adjust Filters</span>
                  <div className="filter-sliders-list">
                    <div className="filter-slider-item">
                      <label>Brightness: <span>{brightness}%</span></label>
                      <input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
                    </div>
                    <div className="filter-slider-item">
                      <label>Contrast: <span>{contrast}%</span></label>
                      <input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
                    </div>
                    <div className="filter-slider-item">
                      <label>Saturation: <span>{saturate}%</span></label>
                      <input type="range" min="50" max="150" value={saturate} onChange={(e) => setSaturate(Number(e.target.value))} />
                    </div>
                    <div className="filter-slider-item">
                      <label>Blur: <span>{blur}px</span></label>
                      <input type="range" min="0" max="10" value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-small" onClick={handleResetFilters} style={{ marginTop: '8px', width: '100%' }}>Reset Filters</button>
                </div>

                <div className="tool-section border-top canvas-export-group" style={{ paddingTop: '12px', marginTop: 'auto' }}>
                  <button className="btn btn-secondary btn-small" onClick={handleDownloadInpaintMask} style={{ width: '100%', marginBottom: '8px' }}>
                    <Download size={12} /> Download Mask
                  </button>
                  <button className="btn btn-secondary btn-small" onClick={handleUseCanvasAsImg2Img} style={{ width: '100%', marginBottom: '8px' }}>
                    Use as img2img target
                  </button>
                  <button className="btn btn-primary btn-small" onClick={handleSaveCanvasEdited} disabled={isLoading} style={{ width: '100%' }}>
                    {isLoading ? <Loader2 className="spinning" size={12} /> : <Save size={12} />} Save As New Image
                  </button>
                </div>
              </div>

              {/* Drawing Area */}
              <div className="canvas-work-area">
                <div className="canvas-container-relative">
                  <canvas 
                    ref={mainCanvasRef} 
                    className="main-draw-canvas"
                    onMouseDown={handleDrawingStart}
                    onMouseMove={handleDrawingMove}
                    onMouseUp={handleDrawingEnd}
                    onMouseLeave={handleDrawingEnd}
                  />
                  <canvas 
                    ref={maskCanvasRef} 
                    className="mask-draw-canvas"
                    onMouseDown={handleDrawingStart}
                    onMouseMove={handleDrawingMove}
                    onMouseUp={handleDrawingEnd}
                    onMouseLeave={handleDrawingEnd}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <button 
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setCanvasImageItem(selectedImage);
                      setBrightness(100);
                      setContrast(100);
                      setSaturate(100);
                      setBlur(0);
                      setShowCanvasEditor(true);
                      setSelectedImage(null);
                    }}
                  >
                    <Edit size={14} /> Edit in Canvas
                  </button>
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
