import express from 'express';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;
const OUTPUT_DIR = path.join(__dirname, 'output');

app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/output', express.static(OUTPUT_DIR));

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatTranscript(items) {
  return items
    .map(item => item.text.trim())
    .filter(text => text.length > 0)
    .join('\n');
}

app.post('/api/transcribe', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.json({ success: false, error: 'URLを入力してください' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.json({ success: false, error: '無効なYouTube URLです' });
  }

  let transcript = null;
  let lang = null;

  // 日本語字幕を試みる
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    if (items && items.length > 0) {
      transcript = formatTranscript(items);
      lang = 'ja';
    }
  } catch (e) {
    // 日本語字幕なし
  }

  // 英語字幕を試みる
  if (!transcript) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (items && items.length > 0) {
        transcript = formatTranscript(items);
        lang = 'en';
      }
    } catch (e) {
      // 英語字幕もなし
    }
  }

  // 言語指定なしで試みる（自動生成字幕など）
  if (!transcript) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId);
      if (items && items.length > 0) {
        transcript = formatTranscript(items);
        lang = 'auto';
      }
    } catch (e) {
      // 字幕なし
    }
  }

  if (!transcript) {
    return res.json({ success: false, error: 'この動画には字幕がありません' });
  }

  // txtファイルに保存
  const filename = `${videoId}_${Date.now()}.txt`;
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, transcript, 'utf-8');

  res.json({ success: true, text: transcript, filename, lang });
});

app.listen(PORT, () => {
  console.log(`YTTrans サーバー起動中: http://localhost:${PORT}`);
});
