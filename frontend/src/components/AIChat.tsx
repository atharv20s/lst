import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RefreshCw, MessageSquare } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export const AIChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: 'Hi there! I am **Kirat**, your AI Staking Assistant. Ask me anything about the liquid staking pool, current rates, transaction mechanics, or yield calculations!'
    }
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    const userMsg = textToSend.trim();
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const serverPort = '3000';
      const chatUrl = `http://localhost:${serverPort}/api/chat`;

      // Slice history to include last 10 messages
      const history = messages.slice(-10);

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history
        })
      });

      if (!res.ok) {
        throw new Error(`Server status ${res.status}`);
      }

      const data = await res.json() as { reply: string };
      setMessages(prev => [...prev, { role: 'model', text: data.reply }]);

    } catch (err: any) {
      console.error('Chat failed:', err);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: '❌ Apologies, I am having trouble reaching the local AI backend server. Please verify your Express server is running on port 3000.' 
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Render text containing simple markdown
  const renderMessageContent = (text: string) => {
    // Basic bold **text** replacement
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.1rem 0.3rem; border-radius: 4px; font-family: var(--font-mono);">$1</code>')
      .split('\n').join('<br/>');
      
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const quickPrompts = [
    "What's the exchange rate?",
    "How do I stake SOL?",
    "Calculate 5 SOL staking yield",
    "Show pool stats"
  ];

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '600px', padding: '1.5rem' }}>
      {/* Title */}
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
        <Bot size={22} style={{ color: 'var(--color-primary)' }} />
        AI Staking Assistant
      </h3>

      {/* Message box */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingRight: '0.5rem', marginBottom: '1rem' }}>
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            style={{ 
              display: 'flex', 
              gap: '0.75rem', 
              alignItems: 'flex-start',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              maxWidth: '85%',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start'
            }}
          >
            {/* Avatar */}
            <div style={{ 
              background: msg.role === 'user' ? 'var(--color-primary-glow)' : 'var(--color-secondary-glow)',
              border: msg.role === 'user' ? '1px solid var(--color-primary)' : '1px solid var(--color-secondary)',
              borderRadius: '50%',
              padding: '0.35rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {msg.role === 'user' ? <User size={14} style={{ color: 'var(--color-primary)' }} /> : <Bot size={14} style={{ color: 'var(--color-secondary)' }} />}
            </div>

            {/* Bubble */}
            <div style={{ 
              background: msg.role === 'user' ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              fontSize: '0.9rem',
              color: 'var(--text-primary)',
              lineHeight: 1.4,
              wordBreak: 'break-word'
            }}>
              {renderMessageContent(msg.text)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <RefreshCw size={14} style={{ animation: 'spin 1.5s linear infinite' }} />
            <span>AI is typing...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length === 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p)}
              disabled={loading}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '20px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                transition: 'var(--transition-smooth)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <form 
        onSubmit={(e) => { e.preventDefault(); handleSend(inputText); }}
        style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 'var(--border-radius-md)', padding: '0.25rem 0.5rem 0.25rem 0.75rem', alignItems: 'center' }}
      >
        <MessageSquare size={16} style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Ask AI anything..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={loading}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'white',
            padding: '0.6rem 0',
            fontSize: '0.9rem',
            fontFamily: 'var(--font-sans)'
          }}
        />
        <button
          type="submit"
          disabled={!inputText.trim() || loading}
          style={{
            background: 'var(--color-primary)',
            border: 'none',
            color: 'white',
            borderRadius: 'var(--border-radius-sm)',
            padding: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !inputText.trim() || loading ? 0.4 : 1
          }}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
