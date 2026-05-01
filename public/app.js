const form = document.getElementById('bulkForm');
const resultBox = document.getElementById('result');
const sendBtn = document.getElementById('sendBtn');
const subjectInput = form.querySelector('input[name="subjectTemplate"]');
const bodyInput = form.querySelector('textarea[name="bodyTemplate"]');
const senderInput = form.querySelector('input[name="senderName"]');
const fileInput = form.querySelector('input[name="csvFile"]');
const previewContent = document.getElementById('previewContent');
const presetSelect = document.getElementById('templatePreset');
const applyAutoFormatBtn = document.getElementById('applyAutoFormat');
const tokenButtons = document.querySelectorAll('.token-btn[data-token]');
const apiBaseInput = form.querySelector('input[name="apiBaseUrl"]');

const defaultSendLabel = sendBtn.textContent;
let sampleRow = {
  name: 'Alex',
  company: 'Acme Labs',
  date: 'Monday',
  unsubscribe_link: 'https://example.com/unsubscribe'
};
let detectedHeaders = [];

const templatePresets = {
  welcome: {
    subject: 'Welcome {{name}} to {{company}}',
    body: 'Hi {{name}},\n\nWelcome to {{company}}. We are excited to have you onboard.\n\nIf you have questions, reply to this email anytime.'
  },
  promo: {
    subject: '{{name}}, special offer for {{company}}',
    body: 'Hi {{name}},\n\nWe have a limited offer available this week for {{company}}.\n\nOffer expires on {{date}}.\nUse this link to unsubscribe anytime: {{unsubscribe_link}}'
  },
  followup: {
    subject: 'Quick follow-up for {{name}}',
    body: 'Hi {{name}},\n\nJust checking in regarding your recent request at {{company}}.\n\nHappy to help with the next step.'
  },
  onboarding: {
    subject: 'Getting started at {{company}}',
    body: 'Hi {{name}},\n\nHere are the next steps to get set up with {{company}}:\n- Confirm your profile\n- Review the quick-start guide\n- Reply with any questions\n\nWe are here to help.'
  },
  event: {
    subject: 'Invitation: {{company}} event on {{date}}',
    body: 'Hi {{name}},\n\nYou are invited to our event hosted by {{company}} on {{date}}.\n\nRSVP by replying to this email.'
  },
  reminder: {
    subject: 'Friendly reminder for {{name}}',
    body: 'Hi {{name}},\n\nJust a gentle reminder about the next step for {{company}}.\n\nLet us know if you need any help.'
  },
  invoice: {
    subject: 'Invoice from {{company}}',
    body: 'Hi {{name}},\n\nAttached is your invoice from {{company}}.\n\nPlease let us know if anything looks off.'
  },
  renewal: {
    subject: '{{company}} renewal notice',
    body: 'Hi {{name}},\n\nYour plan with {{company}} is coming up for renewal on {{date}}.\n\nReply if you would like to make changes.'
  },
  feedback: {
    subject: 'Quick feedback request from {{company}}',
    body: 'Hi {{name}},\n\nWe would love a quick note on your experience with {{company}}.\n\nYour feedback helps us improve.'
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillTemplate(template, data) {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const value = data[key.trim()];
    return value !== undefined && value !== null && value !== '' ? value : `[${key.trim()}]`;
  });
}

function cleanupText(input) {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveName(row) {
  const nameKeys = ['name', 'first_name', 'firstname', 'full_name'];
  const key = Object.keys(row).find((k) => nameKeys.includes(k.toLowerCase()));
  return key ? row[key] : '';
}

function autoFormatTemplateText(text) {
  let out = cleanupText(text);
  if (!out) {
    return out;
  }

  const firstLine = (out.split('\n').find((line) => line.trim()) || '').toLowerCase();
  if (!/^(hi|hello|dear)\b/.test(firstLine)) {
    const recipientName = resolveName(sampleRow) || '{{name}}';
    out = `Hi ${recipientName},\n\n${out}`;
  }

  if (!/(best regards|regards|thanks|thank you|sincerely)\s*,?\s*$/i.test(out)) {
    const senderName = senderInput.value.trim() || 'Team';
    out = `${out}\n\nBest regards,\n${senderName}`;
  }

  return out;
}

function renderPreview() {
  const previewSubject = fillTemplate(subjectInput.value || '', sampleRow);
  const previewBody = fillTemplate(bodyInput.value || '', sampleRow);

  previewContent.innerHTML = `
    <p><strong>Subject:</strong> ${escapeHtml(previewSubject || '(empty)')}</p>
    <p><strong>Body:</strong></p>
    <pre>${escapeHtml(previewBody || '(empty)')}</pre>
  `;
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const pos = start + text.length;
  input.focus();
  input.setSelectionRange(pos, pos);
  renderPreview();
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((value) => value.trim());
}

function parseSampleRow(csvText) {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const headers = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);

  if (!headers.length) {
    return null;
  }

  const row = {};
  headers.forEach((header, i) => {
    if (header) {
      row[header.trim()] = values[i] ? values[i].trim() : '';
    }
  });

  return { row, headers };
}

function renderDetectedFields() {
  const list = document.getElementById('detectedList');
  if (!list) return;

  if (!detectedHeaders.length) {
    list.innerHTML = 'No file loaded.';
    return;
  }

  list.innerHTML = detectedHeaders
    .map((h) => `<li>${escapeHtml(h || '(blank)')}</li>`)
    .join('');
}

function updateFileLabel(input) {
  const row = input.closest('.file-row');
  if (!row) return;
  const nameLabel = row.querySelector('.file-name');
  if (!nameLabel) return;
  const file = input.files && input.files[0];
  nameLabel.textContent = file ? file.name : 'No file chosen';
}

function wireFileInputs() {
  const fileInputs = document.querySelectorAll('.file-input');
  fileInputs.forEach((input) => {
    updateFileLabel(input);
    input.addEventListener('change', () => updateFileLabel(input));
  });
}

function renderResult(data) {
  resultBox.classList.remove('hidden');

  const statusClass = data.ok ? 'ok' : 'err';
  const summary = [
    `<p class="${statusClass}">${data.message || 'Completed.'}</p>`,
    data.total !== undefined ? `<p>Total rows: <strong>${data.total}</strong></p>` : '',
    data.sent !== undefined ? `<p>Sent: <strong>${data.sent}</strong></p>` : '',
    data.failed !== undefined ? `<p>Failed: <strong>${data.failed}</strong></p>` : '',
    data.imagesLoaded !== undefined ? `<p>Files loaded from ZIP: <strong>${data.imagesLoaded}</strong></p>` : '',
    data.attached !== undefined ? `<p>Files attached: <strong>${data.attached}</strong></p>` : '',
    data.unmatchedImages !== undefined ? `<p>Recipients without file match: <strong>${data.unmatchedImages}</strong></p>` : '',
    data.globalImageAttachedCount !== undefined ? `<p>Global image attached to: <strong>${data.globalImageAttachedCount}</strong> emails</p>` : '',
    data.globalLinkIncludedCount !== undefined ? `<p>Global link included in: <strong>${data.globalLinkIncludedCount}</strong> emails</p>` : ''
  ].join('');

  const errors = (data.errors || []).length
    ? `<h3>Errors</h3><ul>${data.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    : '';

  resultBox.innerHTML = summary + errors;
}

function resolveApiUrl() {
  const manualBase = (apiBaseInput.value || '').trim();
  if (manualBase) {
    const clean = manualBase.replace(/\/+$/, '');
    localStorage.setItem('bulkmail_api_base', clean);
    return `${clean}/api/send-bulk`;
  }

  const savedBase = (localStorage.getItem('bulkmail_api_base') || '').trim();
  if (savedBase) {
    return `${savedBase.replace(/\/+$/, '')}/api/send-bulk`;
  }

  return '/api/send-bulk';
}

function getFriendlyApiError(status, bodyText) {
  if (status === 405) {
    return 'API endpoint not allowed (405). If frontend is on GitHub Pages, set "API Server URL" to your backend (Render/Railway/VPS/local tunnel).';
  }
  if (status === 404) {
    return 'API endpoint not found (404). Check your "API Server URL" and backend route /api/send-bulk.';
  }
  if (bodyText && bodyText.trim().startsWith('<')) {
    return 'Server returned HTML instead of JSON. This usually means the request hit a static host, not your Node API.';
  }
  return '';
}

presetSelect.addEventListener('change', () => {
  const preset = templatePresets[presetSelect.value];
  if (!preset) {
    return;
  }

  subjectInput.value = preset.subject;
  bodyInput.value = preset.body;
  renderPreview();
});

applyAutoFormatBtn.addEventListener('click', () => {
  bodyInput.value = autoFormatTemplateText(bodyInput.value);
  renderPreview();
});

tokenButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const token = btn.dataset.token || '';
    const targetName = btn.dataset.target || 'bodyTemplate';
    const input = form.querySelector(`[name="${targetName}"]`);
    if (input) {
      insertAtCursor(input, token);
    }
  });
});

[fileInput, subjectInput, bodyInput, senderInput].forEach((el) => {
  el.addEventListener('input', renderPreview);
});

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || !fileInput.files[0]) {
    return;
  }

  try {
    const text = await fileInput.files[0].text();
    const parsed = parseSampleRow(text);
    if (parsed) {
      sampleRow = { ...sampleRow, ...parsed.row };
      detectedHeaders = parsed.headers || [];
    }
  } catch (_) {
    
  }

  renderPreview();
  renderDetectedFields();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fd = new FormData(form);
  sendBtn.disabled = true;
  sendBtn.textContent = 'SENDING...';
  resultBox.classList.add('hidden');

  try {
    const apiUrl = resolveApiUrl();
    const res = await fetch(apiUrl, {
      method: 'POST',
      body: fd
    });

    const contentType = res.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const rawText = await res.text();
      data = {
        ok: false,
        message: getFriendlyApiError(res.status, rawText) || `Request failed with status ${res.status}.`
      };
    }

    if (!res.ok && data && !data.message) {
      data.message = `Request failed with status ${res.status}.`;
    }

    renderResult(data);
  } catch (err) {
    renderResult({ ok: false, message: `Request failed: ${err.message}` });
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = defaultSendLabel;
  }
});

renderPreview();
renderDetectedFields();
wireFileInputs();

// Prefill saved API base URL for static-host use cases (e.g., GitHub Pages).
const savedApiBase = localStorage.getItem('bulkmail_api_base');
if (savedApiBase && apiBaseInput) {
  apiBaseInput.value = savedApiBase;
}
