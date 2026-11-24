const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }
  return data; // { success, data }
}

// ---- Public (customer) ----
export const createTicket = (payload) => request('/tickets', { method: 'POST', body: payload });
export const getTicketThread = (ticketId, mobileNumber) =>
  request(`/tickets/${ticketId}?mobileNumber=${encodeURIComponent(mobileNumber)}`);
export const addCustomerMessage = (ticketId, payload) =>
  request(`/tickets/${ticketId}/messages/customer`, { method: 'POST', body: payload });

// ---- Auth ----
export const login = (username, password) =>
  request('/auth/login', { method: 'POST', body: { username, password } });

// ---- Internal (agent) ----
export const getAllTickets = (token, status) =>
  request(`/internal/tickets${status ? `?status=${status}` : ''}`, { token });
export const getTicketThreadInternal = (token, ticketId) =>
  request(`/internal/tickets/${ticketId}`, { token });
export const addAgentMessage = (token, ticketId, payloadOrMessage, templateName) => {
  const body = typeof payloadOrMessage === 'string'
    ? { message: payloadOrMessage, templateName }
    : { ...payloadOrMessage, templateName: templateName || payloadOrMessage.templateName };
  return request(`/internal/tickets/${ticketId}/messages`, { method: 'POST', body, token });
};
export const updateTicketStatus = (token, ticketId, status, assignedTo) =>
  request(`/internal/tickets/${ticketId}/status`, { method: 'PUT', body: { status, assignedTo }, token });
export const startNewConversation = (token, payload) =>
  request('/internal/tickets/new', { method: 'POST', body: payload, token });

// ---- Media upload (images, videos, audio, documents) with auto-chunking & compression ----
export async function compressImageIfNeeded(file, maxDimension = 1920, quality = 0.82) {
  if (!file || !file.type?.startsWith('image/') || file.type.includes('svg') || file.type.includes('gif')) {
    return file;
  }
  // If already under 600KB, keep as is
  if (file.size <= 600 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

export const uploadMedia = async (token, { base64, fileName, mimeType }) => {
  const CHUNK_SIZE = 300 * 1024; // 300KB slices: well below Nginx 1MB client_max_body_size
  if (base64.length <= 450 * 1024) {
    return request('/upload', { method: 'POST', body: { base64, fileName, mimeType }, token });
  }

  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);
  let lastResult = null;

  for (let i = 0; i < totalChunks; i++) {
    const chunkData = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    lastResult = await request('/upload/chunk', {
      method: 'POST',
      body: {
        uploadId,
        chunkIndex: i,
        totalChunks,
        data: chunkData,
        fileName,
        mimeType,
      },
      token,
    });
  }

  return lastResult;
};

// ---- WhatsApp (agent) ----
export const getWhatsAppConversations = (token) =>
  request('/whatsapp/conversations', { token });

export const getWhatsAppMessages = (token, conversationId) =>
  request(`/whatsapp/conversations/${conversationId}/messages`, { token });

export const sendWhatsAppMessage = (token, conversationId, payloadOrText, clientTempId) => {
  const body = typeof payloadOrText === 'string'
    ? { text: payloadOrText, clientTempId }
    : { ...payloadOrText, clientTempId };
  return request(`/whatsapp/conversations/${conversationId}/send`, {
    method: 'POST',
    body,
    token
  });
};

export const initiateWhatsAppConversation = (token, payload) =>
  request('/whatsapp/conversations/initiate', {
    method: 'POST',
    body: payload,
    token
  });

export const deleteTicket = (token, ticketId) =>
  request(`/internal/tickets/${ticketId}`, { method: 'DELETE', token });

export const deleteWhatsAppConversation = (token, conversationId) =>
  request(`/whatsapp/conversations/${conversationId}`, { method: 'DELETE', token });

export const deleteWhatsAppMessage = (token, conversationId, messageId) =>
  request(`/whatsapp/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE', token });

export const getWhatsAppTemplates = (token) =>
  request('/whatsapp/templates', { token });
