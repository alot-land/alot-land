export default function LanguagePicker({ result, busy, onChangeLanguage, onTranslate }) {
  const hasTranslations = result.translationLanguages?.length > 0;

  return (
    <div className="card space-y-3 p-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
          Caption track
        </span>
        <select
          value={result.language.key}
          disabled={busy}
          onChange={(event) => onChangeLanguage(event.target.value)}
          className="field text-sm"
        >
          {result.languages.map((language) => (
            <option key={language.key} value={language.key}>
              {language.name}
              {language.isGenerated ? ' (auto-generated)' : ''}
            </option>
          ))}
        </select>
      </label>

      {hasTranslations && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Translate to
          </span>
          <select
            value={result.translatedTo || ''}
            disabled={busy}
            onChange={(event) => onTranslate(event.target.value || null)}
            className="field text-sm"
          >
            <option value="">No translation</option>
            {result.translationLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-muted">
            Machine translation from YouTube — quality varies.
          </span>
        </label>
      )}
    </div>
  );
}
