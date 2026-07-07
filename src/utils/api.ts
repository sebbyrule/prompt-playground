const BACKEND_URL = window.location.port === '5173' ? 'http://localhost:5001' : '';

export function getHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-gemini-key': localStorage.getItem('gemini_api_key') || '',
    'x-claude-key': localStorage.getItem('claude_api_key') || '',
    'x-openai-key': localStorage.getItem('openai_api_key') || '',
    'x-ollama-url': localStorage.getItem('ollama_url') || 'http://localhost:11434',
    'x-lmstudio-url': localStorage.getItem('lmstudio_url') || 'http://localhost:1234',
    'x-comfyui-url': localStorage.getItem('comfyui_url') || 'http://localhost:8188',
  };
}

export const api = {
  get: async (endpoint: string) => {
    const res = await fetch(`${BACKEND_URL}${endpoint}`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      let errMsg = 'Request failed';
      try {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }
    return res.json();
  },
  
  post: async (endpoint: string, data: any) => {
    const res = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let errMsg = 'Request failed';
      try {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }
    return res.json();
  },

  delete: async (endpoint: string) => {
    const res = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      let errMsg = 'Request failed';
      try {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }
    return res.json();
  }
};
export default api;
