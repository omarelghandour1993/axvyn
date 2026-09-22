const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const { Translate } = require('@google-cloud/translate').v2;

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: function (req, file, cb) {
    if (!file.originalname.toLowerCase().endsWith('.srt')) {
      return cb(new Error('Only .srt files are allowed.'));
    }
    cb(null, true);
  }
});

const translate = new Translate({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

function parseSrt(content) {
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const subtitles = [];

  for (const block of blocks) {
    const lines = block.split('\n');

    if (lines.length < 3) continue;

    const number = lines[0].trim();
    const timing = lines[1].trim();
    const text = lines.slice(2).join('\n').trim();

    if (!/^\d+$/.test(number)) continue;
    if (!timing.includes('-->')) continue;
    if (!text) continue;

    subtitles.push({
      number,
      timing,
      text
    });
  }

  return subtitles;
}

function buildSrt(subtitles) {
  return subtitles
    .map((subtitle, index) => {
      return String(index + 1) + '\n' + subtitle.timing + '\n' + subtitle.text;
    })
    .join('\n\n') + '\n\n';
}

async function translateBatch(subtitles, sourceLanguage, targetLanguage) {
  const texts = subtitles.map((s) => s.text);

  const [translations] = await translate.translate(texts, {
    from: sourceLanguage,
    to: targetLanguage
  });

  return subtitles.map((subtitle, index) => ({
    number: subtitle.number,
    timing: subtitle.timing,
    text: translations[index]
  }));
}

function htmlPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Axvyn SRT Translator</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f4f4f4;
      color: #222;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.08);
      padding: 25px;
    }
    h1 {
      text-align: center;
      margin-bottom: 20px;
      font-size: 28px;
    }
    label {
      display: block;
      margin-top: 15px;
      margin-bottom: 6px;
      font-weight: bold;
    }
    input, select, button {
      width: 100%;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #ccc;
      font-size: 14px;
    }
    button {
      margin-top: 20px;
      background: #007bff;
      color: white;
      border: none;
      cursor: pointer;
      font-weight: bold;
    }
    button:hover {
      background: #005ec2;
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .msg {
      display: none;
      margin-top: 18px;
      padding: 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    .msg.show {
      display: block;
    }
    .msg.error {
      background: #ffe5e5;
      color: #a00;
      border: 1px solid #f3b0b0;
    }
    .msg.success {
      background: #e6ffe9;
      color: #0a680a;
      border: 1px solid #b8e8c0;
    }
    .footer {
      text-align: center;
      color: #777;
      margin-top: 30px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Axvyn SRT Translator</h1>

    <label for="srtFile">Choose SRT file</label>
    <input id="srtFile" type="file" accept=".srt" />

    <label for="sourceLanguage">Source language</label>
    <select id="sourceLanguage">
      <option value="ar" selected>Arabic</option>
      <option value="en">English</option>
      <option value="es">Spanish</option>
      <option value="fr">French</option>
      <option value="de">German</option>
      <option value="pt">Portuguese</option>
      <option value="ru">Russian</option>
      <option value="zh-CN">Chinese</option>
      <option value="hi">Hindi</option>
      <option value="ja">Japanese</option>
      <option value="ko">Korean</option>
      <option value="it">Italian</option>
      <option value="nl">Dutch</option>
      <option value="pl">Polish</option>
      <option value="tr">Turkish</option>
    </select>

    <label for="targetLanguage">Target language</label>
    <select id="targetLanguage">
      <option value="en" selected>English</option>
      <option value="ar">Arabic</option>
      <option value="es">Spanish</option>
      <option value="fr">French</option>
      <option value="de">German</option>
      <option value="pt">Portuguese</option>
      <option value="ru">Russian</option>
      <option value="zh-CN">Chinese</option>
      <option value="hi">Hindi</option>
      <option value="ja">Japanese</option>
      <option value="ko">Korean</option>
      <option value="it">Italian</option>
      <option value="nl">Dutch</option>
      <option value="pl">Polish</option>
      <option value="tr">Turkish</option>
    </select>

    <button id="translateBtn" type="button">Translate & Download</button>
    <div id="message" class="msg"></div>

    <div class="footer">© 2024 Axvyn</div>
  </div>

  <script>
    const button = document.getElementById('translateBtn');
    const message = document.getElementById('message');

    function showMessage(text, isError) {
      message.textContent = text;
      message.className = 'msg show ' + (isError ? 'error' : 'success');
    }

    function setBusy(isBusy) {
      button.disabled = isBusy;
      button.textContent = isBusy ? 'Translating...' : 'Translate & Download';
    }

    async function translateSrt() {
      const fileInput = document.getElementById('srtFile');
      const file = fileInput.files[0];

      if (!file) {
        showMessage('Please choose an SRT file first.', true);
        return;
      }

      if (!file.name.toLowerCase().endsWith('.srt')) {
        showMessage('Please choose a valid .srt file.', true);
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showMessage('The file is too large. Maximum size is 5 MB.', true);
        return;
      }

      const sourceLanguage = document.getElementById('sourceLanguage').value;
      const targetLanguage = document.getElementById('targetLanguage').value;

      if (sourceLanguage === targetLanguage) {
        showMessage('Choose different source and target languages.', true);
        return;
      }

      const formData = new FormData();
      formData.append('srtFile', file);
      formData.append('sourceLanguage', sourceLanguage);
      formData.append('targetLanguage', targetLanguage);

      setBusy(true);
      showMessage('Uploading and translating...', false);

      try {
        const response = await fetch('/api/translate-srt', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'The translation failed.');
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('content-disposition') || '';
        let filename = file.name.replace(/\\.srt$/i, '') + '_' + targetLanguage + '.srt';

        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) filename = match[1];

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showMessage('Translation complete. File downloaded.', false);
      } catch (error) {
        showMessage(error.message || 'Translation failed.', true);
      } finally {
        setBusy(false);
      }
    }

    document.getElementById('translateBtn').addEventListener('click', translateSrt);
  </script>
</body>
</html>
  `;
}

app.get('/', (req, res) => {
  res.send(htmlPage());
});

app.post('/api/translate-srt', upload.single('srtFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an SRT file.' });
    }

    const sourceLanguage = (req.body.sourceLanguage || '').trim();
    const targetLanguage = (req.body.targetLanguage || '').trim();

    if (!sourceLanguage || !targetLanguage) {
      return res.status(400).json({ error: 'Language selection is missing.' });
    }

    if (sourceLanguage === targetLanguage) {
      return res.status(400).json({ error: 'Source and target languages must be different.' });
    }

    const content = req.file.buffer.toString('utf8');
    const subtitles = parseSrt(content);

    if (!subtitles.length) {
      return res.status(400).json({ error: 'No valid subtitle blocks were found in the file.' });
    }

    const translated = await translateBatch(subtitles, sourceLanguage, targetLanguage);
    const output = buildSrt(translated);

    const originalName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const outputName = originalName + '_' + targetLanguage + '.srt';

    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.send(output);
  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({
      error: error.message || 'Translation failed.'
    });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  next();
});

app.listen(port, () => {
  console.log(`App running at http://localhost:${port}`);
});
