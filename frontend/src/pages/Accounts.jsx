import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAccounts, createAccount, deleteAccount } from '../api.js';

const TYPE_OPTIONS = ['brand', 'creator', 'agency', 'media', 'personal'];

function AccountCard({ account, onDelete }) {
  const platforms = [
    account.ig_username && 'IG',
    account.tt_username && 'TT',
  ].filter(Boolean);

  return (
    <div style={{
      background: 'var(--color-white)',
      border: 'var(--border)',
      display: 'flex',
      alignItems: 'stretch',
    }}>
      <Link
        to={`/accounts/${account.id}`}
        style={{ flex: 1, padding: '14px 18px', display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            @{account.username}
          </span>
          {account.type_tag && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '1px 6px',
              border: 'var(--border)',
              color: 'var(--color-muted)',
            }}>
              {account.type_tag}
            </span>
          )}
          {platforms.map((p) => (
            <span key={p} style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              padding: '1px 5px',
              background: 'var(--color-black)',
              color: 'var(--color-white)',
              letterSpacing: '0.06em',
            }}>
              {p}
            </span>
          ))}
        </div>
        {account.display_name && (
          <p style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '4px' }}>
            {account.display_name}
          </p>
        )}
        <p className="label">
          {account.savedVideos} saved video{account.savedVideos !== 1 ? 's' : ''}
          {account.tags?.length > 0 && ` · ${account.tags.join(', ')}`}
        </p>
      </Link>
      <button
        onClick={() => onDelete(account.id)}
        style={{
          border: 'none', borderLeft: 'var(--border)',
          padding: '0 14px', background: 'transparent',
          color: 'var(--color-muted)', fontSize: '16px', cursor: 'pointer',
        }}
        title="Delete account"
      >
        ×
      </button>
    </div>
  );
}

function AddAccountModal({ onClose, onSuccess }) {
  const [username, setUsername] = useState('');
  const [igUsername, setIgUsername] = useState('');
  const [ttUsername, setTtUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [typeTag, setTypeTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError('');
    try {
      const acct = await createAccount({
        username: username.trim().replace(/^@/, ''),
        display_name: displayName.trim() || undefined,
        ig_username: igUsername.trim() || undefined,
        tt_username: ttUsername.trim() || undefined,
        type_tag: typeTag || undefined,
      });
      onSuccess(acct);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300,
    }}>
      <div style={{
        background: 'var(--color-white)',
        border: 'var(--border)',
        width: '440px',
        padding: '24px',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '20px',
        }}>
          Add Account
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>Username *</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                autoFocus
                required
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: '4px' }}>IG Username</label>
                <input value={igUsername} onChange={(e) => setIgUsername(e.target.value)} placeholder="ig_handle" />
              </div>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: '4px' }}>TT Username</label>
                <input value={ttUsername} onChange={(e) => setTtUsername(e.target.value)} placeholder="tt_handle" />
              </div>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>Display Name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Brand / Creator name" />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>Type</label>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeTag(typeTag === t ? '' : t)}
                    style={{
                      background: typeTag === t ? 'var(--color-black)' : 'transparent',
                      color: typeTag === t ? 'var(--color-white)' : 'var(--color-black)',
                      border: 'var(--border)',
                      padding: '4px 10px',
                      fontSize: '9px',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p style={{ color: '#c00', fontFamily: 'var(--font-mono)', fontSize: '10px', marginTop: '12px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? 'Adding…' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    listAccounts().then(setAccounts).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    await deleteAccount(id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  function handleSuccess(acct) {
    setShowModal(false);
    setAccounts((prev) => [{ ...acct, savedVideos: 0 }, ...prev]);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: 'var(--border)', background: 'var(--color-white)',
      }}>
        <span className="label">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
        <button className="primary" onClick={() => setShowModal(true)}>+ Add Account</button>
      </div>

      <main style={{ padding: '24px', maxWidth: '720px' }}>
        {loading ? (
          <p className="label">Loading…</p>
        ) : accounts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--color-muted)', marginBottom: '24px',
            }}>
              No accounts yet — they're added automatically when you save a video
            </p>
            <button className="primary" onClick={() => setShowModal(true)}>+ Add Manually</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {accounts.map((a) => <AccountCard key={a.id} account={a} onDelete={handleDelete} />)}
          </div>
        )}
      </main>

      {showModal && (
        <AddAccountModal onClose={() => setShowModal(false)} onSuccess={handleSuccess} />
      )}
    </div>
  );
}
