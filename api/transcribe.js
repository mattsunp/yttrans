import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    if (items && items.length > 0) { transcript = formatTranscript(items); lang = 'ja'; }
  } catch (e) {}

  if (!transcript) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (items && items.length > 0) { transcript = formatTranscript(items); lang = 'en'; }
    } catch (e) {}
  }

  if (!transcript) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId);
      if (items && items.length > 0) { transcript = formatTranscript(items); lang = 'auto'; }
    } catch (e) {}
  }

  if (!transcript) {
    return res.json({ success: false, error: 'この動画には字幕がありません' });
  }

  res.json({ success: true, text: transcript, lang, videoId });
}
