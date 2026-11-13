import React, { useState } from 'react';
import AgentDashboard from './pages/AgentDashboard.jsx';
import WhatsAppConversation from './pages/WhatsappConversation.jsx';
import { c, s } from './styles.js';

const TABS = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('tickets');

  return (
    <div style={s.page}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '10px 16px',
          background: c.card,
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background: activeTab === t.key ? c.primary : 'transparent',
              color: activeTab === t.key ? c.textOnPrimary : c.textMuted,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ height: 'calc(100vh - 49px)' }}>
        {activeTab === 'tickets' ? <AgentDashboard /> : <WhatsAppConversation />}
      </div>
    </div>
  );
}