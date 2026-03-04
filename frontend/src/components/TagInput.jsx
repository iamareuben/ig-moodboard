import React, { useState } from 'react';

export default function TagInput({ tags = [], onChange, dark = false }) {
  const [input, setInput] = useState('');

  const textColor = dark ? 'rgba(255,255,255,0.85)' : 'var(--color-text)';
  const mutedColor = dark ? 'rgba(255,255,255,0.4)' : 'var(--color-muted)';
  const tagBg = dark ? 'rgba(255,255,255,0.1)' : 'var(--color-bg)';
  const tagBorder = dark ? 'rgba(255,255,255,0.2)' : 'var(--color-border)';

  function commit(raw) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput('');
  }

  function remove(tag) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      remove(tags[tags.length - 1]);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            letterSpacing: '0.05em',
            background: tagBg,
            color: textColor,
            border: `1px solid ${tagBorder}`,
            padding: '2px 5px 2px 6px',
          }}
        >
          {tag}
          <button
            onClick={() => remove(tag)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              opacity: 0.55,
              padding: 0,
              fontSize: '11px',
              lineHeight: 1,
              display: 'flex',
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => input && commit(input)}
        placeholder={tags.length === 0 ? 'add tag...' : '+tag'}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          letterSpacing: '0.05em',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: mutedColor,
          padding: '2px 0',
          width: input ? `${input.length + 3}ch` : '7ch',
          minWidth: '4ch',
        }}
      />
    </div>
  );
}
