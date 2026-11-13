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
export const addAgentMessage = (token, ticketId, message) =>
  request(`/internal/tickets/${ticketId}/messages`, { method: 'POST', body: { message }, token });
export const updateTicketStatus = (token, ticketId, status, assignedTo) =>
  request(`/internal/tickets/${ticketId}/status`, { method: 'PUT', body: { status, assignedTo }, token });
export const startNewConversation = (token, { mobileNumber, customerName, message }) =>
  request('/internal/tickets/new', { method: 'POST', body: { mobileNumber, customerName, message }, token });
// ---- WhatsApp (agent) ----
export const getWhatsAppConversations = (token) =>
  request('/whatsapp/conversations', { token });
export const getWhatsAppMessages = (token, conversationId) =>
  request(`/whatsapp/conversations/${conversationId}/messages`, { token });
export const sendWhatsAppMessage = (token, conversationId, text, clientTempId) =>
  request(`/whatsapp/conversations/${conversationId}/send`, {
    method: 'POST',
    body: { text, clientTempId },
    token
  });