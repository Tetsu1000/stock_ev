export const runtime = 'edge';
export const dynamic = 'force-dynamic';

async function fetchYahoo(ticker: string) {
  // 例: 7203.T
  const u = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json = await res.json();
  const r = json?.quoteResponse?.result?.[0];
  const price = r?.regularMarketPrice ?? r?.postMarketPrice ?? r?.preMarketPrice;
  if (price == null) throw new Error('yahoo no price');
  return { source: 'yahoo', price: Number(price) };
}

async function fetchStooq(ticker: string) {
  // Stooq は "7203.jp" 形式（.T→.jp をざっくり対応）
  const s = ticker.toLowerCase().endsWith('.t')
    ? ticker.toLowerCase().replace(/\.t$/, '.jp')
    : ticker.toLowerCase();
  const u = `https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const csv = await res.text();
  const first = csv.trim().split('\n')[1]; // headerの次
  const cols = first?.split(',');
  const close = cols && Number(cols[cols.length - 2]); // 終値
  if (!close) throw new Error('stooq parse error');
  return { source: 'stooq', price: close };
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // CORS 開放（フロントから叩けるように）
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Cache-Control': 'max-age=0, s-maxage=60' // エッジで60秒キャッシュ
    }
  });
}
function err(message: string, status = 500) {
  return ok({ ok: false, message }, status);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.trim();
  if (!ticker) return err('ticker required', 400);

  try {
    // 1. Yahoo
    try {
      const r = await fetchYahoo(ticker);
      return ok({ ok: true, ...r });
    } catch (e) {
      // 続行
    }
    // 2. Stooq
    const r2 = await fetchStooq(ticker);
    return ok({ ok: true, ...r2 });
  } catch (e: any) {
    return err(String(e?.message ?? e));
  }
}

export async function OPTIONS() {
  // CORS preflight
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
