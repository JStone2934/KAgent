import {
  Candle,
  KagentEvent,
  LastEditTrend,
  MarketPayload,
  SymbolSummary,
  SymbolsFile,
} from "./types";

const NEW_IPO_WINDOW_MS = 60_000;

export function eventToCandle(e: KagentEvent): Candle {
  const open = e.lines_before;
  const close = e.lines_after;
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);

  let high = e.lines_high;
  let low = e.lines_low;
  if (high === undefined || low === undefined) {
    high = Math.max(bodyTop, open + e.added);
    low = Math.min(bodyBottom, Math.max(0, open - e.removed));
  }
  high = Math.max(high, bodyTop);
  low = Math.min(low, bodyBottom);

  return {
    time: Math.floor(e.ts / 1000),
    open,
    high,
    low,
    close,
    volume: e.added + e.removed,
    edit_index: e.edit_index,
    is_ipo: e.is_ipo,
  };
}

export function buildCandlesForFile(events: KagentEvent[], file: string): Candle[] {
  return events
    .filter((e) => e.file === file)
    .sort((a, b) => a.edit_index - b.edit_index)
    .map(eventToCandle);
}

/** 最近一次编辑的涨跌（收盘行数 vs 开盘行数，与 K 线颜色一致） */
export function lastEditTrendForFile(
  events: KagentEvent[],
  file: string
): LastEditTrend | null {
  const fileEvents = events.filter((e) => e.file === file);
  if (!fileEvents.length) {
    return null;
  }
  const last = fileEvents.reduce((a, b) =>
    a.edit_index > b.edit_index ||
    (a.edit_index === b.edit_index && a.ts >= b.ts)
      ? a
      : b
  );
  if (last.lines_after > last.lines_before) {
    return "up";
  }
  if (last.lines_after < last.lines_before) {
    return "down";
  }
  return "flat";
}

export function buildMarketPayload(
  events: KagentEvent[],
  symbolsDoc: SymbolsFile,
  selectedFile: string | null,
  now = Date.now()
): MarketPayload {
  const candles: Record<string, Candle[]> = {};
  const files = new Set<string>([
    ...Object.keys(symbolsDoc.symbols),
    ...events.map((e) => e.file),
  ]);

  const netByFile = new Map<string, number>();
  for (const e of events) {
    netByFile.set(e.file, (netByFile.get(e.file) ?? 0) + e.net);
  }

  const symbols: SymbolSummary[] = [...files]
    .map((file) => {
      const info = symbolsDoc.symbols[file];
      const ipo_ts = info?.ipo_ts ?? events.find((ev) => ev.file === file)?.ts ?? 0;
      const edit_count =
        info?.edit_count ?? events.filter((ev) => ev.file === file).length;
      return {
        file,
        ipo_ts,
        edit_count,
        last_lines: info?.last_lines ?? 0,
        last_ts: info?.last_ts ?? ipo_ts,
        total_net: netByFile.get(file) ?? 0,
        last_trend: lastEditTrendForFile(events, file),
        is_new: now - ipo_ts < NEW_IPO_WINDOW_MS,
      };
    })
    .sort((a, b) => b.ipo_ts - a.ipo_ts);

  const active =
    selectedFile && files.has(selectedFile)
      ? selectedFile
      : symbols[0]?.file ?? null;

  if (active) {
    candles[active] = buildCandlesForFile(events, active);
  }

  return { symbols, selectedFile: active, candles };
}
