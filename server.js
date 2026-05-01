const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const AdmZip = require('adm-zip');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof k === 'string') {
      out[k.trim()] = (v || '').toString().trim();
    }
  }
  return out;
}

function renderTemplate(template, row) {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => row[key.trim()] || '');
}

function resolveRecipientName(row) {
  const keys = ['name', 'first_name', 'firstname', 'full_name'];
  const key = Object.keys(row).find((k) => keys.includes(k.toLowerCase()));
  return key ? row[key] : '';
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

function autoFormatEmailText(text, row, senderName) {
  let out = cleanupText(text);
  if (!out) {
    return out;
  }

  const firstLine = (out.split('\n').find((line) => line.trim()) || '').toLowerCase();
  if (!/^(hi|hello|dear)\b/.test(firstLine)) {
    const name = resolveRecipientName(row) || 'there';
    out = `Hi ${name},\n\n${out}`;
  }

  if (!/(best regards|regards|thanks|thank you|sincerely)\s*,?\s*$/i.test(out)) {
    out = `${out}\n\nBest regards,\n${senderName || 'Team'}`;
  }

  return out;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const htmlBlocks = blocks.map((block) => {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const isList = lines.every((line) => /^[-*]\s+/.test(line));

    if (isList) {
      const items = lines
        .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    return `<p>${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`;
  });

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111;">
      ${htmlBlocks.join('')}
    </div>
  `;
}

function normalizeNameKey(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function normalizeUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function buildImageMapFromZip(buffer) {
  const zip = new AdmZip(buffer);
  const map = new Map();

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const entryName = path.basename(entry.entryName);
    const ext = path.extname(entryName).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.pdf'].includes(ext)) {
      continue;
    }

    const key = normalizeNameKey(path.parse(entryName).name);
    if (!key || map.has(key)) {
      continue;
    }

    map.set(key, {
      filename: entryName,
      content: entry.getData(),
      contentType: getContentType(entryName)
    });
  }

  return map;
}

function getImageKeysForRow(row) {
  const keys = new Set();

  const name = resolveRecipientName(row);
  if (name) {
    keys.add(normalizeNameKey(name));
  }

  const emailKey = Object.keys(row).find((k) => k.toLowerCase() === 'email');
  const email = emailKey ? (row[emailKey] || '').trim() : '';
  if (email.includes('@')) {
    keys.add(normalizeNameKey(email.split('@')[0]));
  }

  for (const keyName of ['first_name', 'firstname', 'last_name', 'lastname']) {
    const k = Object.keys(row).find((x) => x.toLowerCase() === keyName);
    if (k && row[k]) {
      keys.add(normalizeNameKey(row[k]));
    }
  }

  return [...keys].filter(Boolean);
}

app.post('/api/send-bulk', upload.fields([
  { name: 'csvFile', maxCount: 1 },
  { name: 'imageZip', maxCount: 1 },
  { name: 'globalImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { gmail, appPassword, subjectTemplate, bodyTemplate, senderName, globalLink } = req.body;
    const autoFormat = req.body.autoFormat === 'on';
    const attachImagesByName = req.body.attachImagesByName === 'on';

    if (!gmail || !appPassword || !subjectTemplate || !bodyTemplate) {
      return res.status(400).json({ ok: false, message: 'All required form fields must be filled.' });
    }

    const csvUpload = req.files && req.files.csvFile ? req.files.csvFile[0] : null;
    const zipUpload = req.files && req.files.imageZip ? req.files.imageZip[0] : null;
    const globalImageUpload = req.files && req.files.globalImage ? req.files.globalImage[0] : null;

    if (!csvUpload || !csvUpload.buffer) {
      return res.status(400).json({ ok: false, message: 'CSV file is required.' });
    }

    const normalizedGlobalLink = normalizeUrl(globalLink);
    if (globalLink && !normalizedGlobalLink) {
      return res.status(400).json({ ok: false, message: 'Global link is invalid. Please use a full URL like https://example.com' });
    }

    let imageMap = new Map();
    if (zipUpload && zipUpload.buffer) {
      try {
        imageMap = buildImageMapFromZip(zipUpload.buffer);
      } catch (_) {
        return res.status(400).json({ ok: false, message: 'Invalid ZIP file. Please upload a valid ZIP.' });
      }
    }

    const csvText = csvUpload.buffer.toString('utf8');
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }).map(normalizeRow);

    if (!records.length) {
      return res.status(400).json({ ok: false, message: 'CSV has no recipient rows.' });
    }

    const hasEmail = Object.keys(records[0]).some((key) => key.toLowerCase() === 'email');
    if (!hasEmail) {
      return res.status(400).json({ ok: false, message: "CSV must contain an 'email' column." });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmail,
        pass: appPassword
      }
    });

    let sent = 0;
    let attached = 0;
    let unmatchedImages = 0;
    let globalImageAttachedCount = 0;
    let globalLinkIncludedCount = 0;
    const errors = [];

    for (let i = 0; i < records.length; i += 1) {
      const row = records[i];
      const emailKey = Object.keys(row).find((k) => k.toLowerCase() === 'email');
      const to = emailKey ? row[emailKey] : '';

      if (!to) {
        errors.push(`Row ${i + 2}: missing email address.`);
        continue;
      }

      const subject = renderTemplate(subjectTemplate, row);
      const rawBody = renderTemplate(bodyTemplate, row);
      const formattedBody = autoFormat
        ? autoFormatEmailText(rawBody, row, senderName ? senderName.trim() : '')
        : cleanupText(rawBody);
      const finalTextBody = normalizedGlobalLink
        ? `${formattedBody}\n\nLink: ${normalizedGlobalLink}`
        : formattedBody;
      const finalHtmlBody = normalizedGlobalLink
        ? `${textToHtml(formattedBody)}<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin-top:14px;"><a href="${escapeHtml(normalizedGlobalLink)}" target="_blank" rel="noopener noreferrer">Open Link</a></p>`
        : textToHtml(formattedBody);

      const attachments = [];
      if (attachImagesByName && imageMap.size > 0) {
        const matchKeys = getImageKeysForRow(row);
        let matched = null;

        for (const key of matchKeys) {
          if (imageMap.has(key)) {
            matched = imageMap.get(key);
            break;
          }
        }

        if (matched) {
          attachments.push({
            filename: matched.filename,
            content: matched.content,
            contentType: matched.contentType
          });
          attached += 1;
        } else {
          unmatchedImages += 1;
          errors.push(`Row ${i + 2} (${to}): no matching file in ZIP.`);
        }
      }

      if (globalImageUpload && globalImageUpload.buffer) {
        attachments.push({
          filename: globalImageUpload.originalname || 'global-image',
          content: globalImageUpload.buffer,
          contentType: globalImageUpload.mimetype || getContentType(globalImageUpload.originalname || '')
        });
        globalImageAttachedCount += 1;
      }

      if (normalizedGlobalLink) {
        globalLinkIncludedCount += 1;
      }

      const mailOptions = {
        from: gmail,
        to,
        subject,
        text: finalTextBody,
        html: finalHtmlBody,
        attachments
      };

      try {
        await transporter.sendMail(mailOptions);
        sent += 1;
      } catch (err) {
        errors.push(`Row ${i + 2} (${to}): ${err.message}`);
      }
    }

    return res.json({
      ok: errors.length === 0,
      message: 'Bulk send finished.',
      total: records.length,
      sent,
      failed: errors.length,
      attached,
      unmatchedImages,
      imagesLoaded: imageMap.size,
      globalImageAttachedCount,
      globalLinkIncludedCount,
      errors
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: `Server error: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Bulk mail app running at http://localhost:${PORT}`);
});
