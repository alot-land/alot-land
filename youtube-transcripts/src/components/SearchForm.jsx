import { useState } from 'react';

export default function SearchForm({ initialValue = '', busy, onSubmit }) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !busy) onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste a YouTube link or video ID"
        spellCheck="false"
        autoComplete="off"
        autoCapitalize="off"
        aria-label="YouTube link or video ID"
        className="field flex-1 font-mono text-sm"
      />
      <button type="submit" className="btn-primary sm:w-40" disabled={busy || !value.trim()}>
        {busy ? 'Fetching…' : 'Get transcript'}
      </button>
    </form>
  );
}
