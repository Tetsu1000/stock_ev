// /api/quote.js  （Node.js Serverless Function 版）
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
    if (!ticker) {
      res.status(400).json({ ok: false, error: 'ticker is required' });
      return;
    }

    // ユーティリティ
    const ok = (n) => Number.isFinite(n) && n > 0;

    // 1) Hosted API（あなたの既存）をまず試行
    try {
      const r = await fetch(
        `https://${req.headers.host}/api/quote` /* 既存の hosted が無い場合はスキップ */,
        { headers: { 'x-skip': '1' } } // 循環を避けるためダミー
      );
      // ↑ Hosted API が無い構成なら必ず 404/502 になるので catch に落ちます
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (ok(j?.price)) {
          setCache(res);
          res.status(200).json({ ok: true, price: j.price, source: 'hosted' });
          return;
        }
      }
    } catch (_) {}

    // 2) Yahoo! Finance（クライアント直叩きは CORS で弾かれる→サーバーから代理）
    try {
      const y = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
          ticker
        )}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (y.ok) {
        const data = await y.json();
        const p = Number(data?.quoteResponse?.result?.[0]?.regularMarketPrice);
        if (ok(p)) {
          setCache(res);
          res.status(200).json({ ok: true, price: p, source: 'yahoo' });
          return;
        }
      }
    } catch (_) {}

    // 3) Stooq（CSV をパース）
    try {
      // 例: https://stooq.com/q/l/?s=7203.jp&f=sd2t2ohlcv&h&e=csv
      const suffix = ticker.endsWith('.T') ? ticker.replace('.T', '.jp') : ticker;
      const s = await fetch(
        `https://stooq.com/q/l/?s=${encodeURIComponent(
          suffix
        )}&f=sd2t2ohlcv&h&e=csv`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (s.ok) {
        const text = await s.text();
        // 1行目ヘッダ, 2行目データ
        const line = (text.split('\n')[1] || '').trim();
        const cols = line.split(',');
        const close = Number(cols[6]); // o,h,l,c,v の c
        if (ok(close)) {
          setCache(res);
          res.status(200).json({ ok: true, price: close, source: 'stooq' });
          return;
        }
      }
    } catch (_) {}

    // すべてダメ
    res.status(502).json({ ok: false, error: 'fetch_failed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
}

function setCache(res) {
  // 5分 CDN キャッシュ（ブラウザは 0）
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  // CORS（必要なら）
  res.setHeader('Access-Control-Allow-Origin', '*');
}
