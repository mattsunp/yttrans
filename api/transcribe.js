export const config = { runtime: 'edge' };

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const CONSENT_COOKIE = 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AwGgJlbiACIgIIAA; CONSENT=YES+cb';

const CLIENTS = [
  {
    name: 'WEB',
    id: '1',
    context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'ja', gl: 'JP' } },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    name: 'WEB_EMBEDDED',
    id: '56',
    context: { client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20240723.01.00', hl: 'ja' } },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    name: 'TV_EMBEDDED',
    id: '85',
    context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'ja' } },
    userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36',
  },
  {
    name: 'ANDROID',
    id: '3',
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
  },
];

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

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function parseXml(xml) {
  const items = [];
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
    if (text) items.push(text);
  }
  return items.join('\n');
}

async function fetchCaptionTracks(videoId) {
  const errors = [];
  for (const client of CLIENTS) {
    try {
      const res = await fetch(INNERTUBE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'X-YouTube-Client-Name': client.id,
          'X-YouTube-Client-Version': client.context.client.clientVersion,
          'Origin': 'https://www.youtube.com',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
          'Cookie': CONSENT_COOKIE,
        },
        body: JSON.stringify({ context: client.context, videoId }),
      });
      if (!res.ok) { errors.push(`${client.name}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const playability = data?.playabilityStatus?.status;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return { tracks, client: client.name, errors };
      }
      errors.push(`${client.name}: no tracks (playability=${playability})`);
    } catch (e) {
      errors.push(`${client.name}: ${e.message}`);
    }
  }
  return { tracks: [], client: null, errors };
}

async function downloadTranscript(trackUrl) {
  const res = await fetch(trackUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': CONSENT_COOKIE,
    }
  });
  return parseXml(await res.text());
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { url } = await request.json();
  if (!url) {
    return new Response(JSON.stringify({ success: false, error: 'URLを入力してください' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return new Response(JSON.stringify({ success: false, error: '無効なYouTube URLです' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { tracks, client, errors } = await fetchCaptionTracks(videoId);

  if (tracks.length === 0) {
    return new Response(JSON.stringify({ success: false, error: 'この動画には字幕がありません', debug: errors }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const preferred = ['ja', 'en'];
  let selected = null;
  let lang = null;
  for (const code of preferred) {
    selected = tracks.find(t => t.languageCode === code);
    if (selected) { lang = code; break; }
  }
  if (!selected) { selected = tracks[0]; lang = selected.languageCode; }

  try {
    const trackHost = new URL(selected.baseUrl).hostname;
    if (!trackHost.endsWith('.youtube.com')) {
      return new Response(JSON.stringify({ success: false, error: '字幕URLが不正です' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch {
    return new Response(JSON.stringify({ success: false, error: '字幕URLの解析に失敗しました' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const transcript = await downloadTranscript(selected.baseUrl);
  if (!transcript) {
    return new Response(JSON.stringify({ success: false, error: '字幕の取得に失敗しました' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true, text: transcript, lang, videoId, usedClient: client }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
