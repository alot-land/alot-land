import { FORMATS, suggestFilename } from '../../shared/formats.mjs';

/** Render a result in the given format and save it as a file. */
export function downloadTranscript(result, format) {
  const spec = FORMATS[format];
  const blob = new Blob([spec.render(result)], { type: spec.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestFilename(result, format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give Safari a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and permission; fall back to a
    // hidden textarea + execCommand, which still works in more places.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    textarea.remove();
    return ok;
  }
}
