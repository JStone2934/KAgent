import {
  Candle,
  KagentEvent,
  LastEditTrend,
  MarketPayload,
  SymbolSummary,
  SymbolsFile,
} from "./types";
import { isWorkspaceFileMissing } from "./symbolDelist";

/** 列表「新」「改」标记的有效时间（毫秒） */
const ACTIVITY_WINDOW_MS = 60_000;

function clampHighLow(
  open: number,
  close: number,
  high?: number,
  low?: number
): { high: number; low: number } {
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);
  let h = high ?? bodyTop;
  let l = low ?? bodyBottom;
  h = Math.max(h, bodyTop);
  l = Math.min(l, bodyBottom);
  return { high: h, low: l };
}

function candleBase(e: KagentEvent): Pick<Candle, "time" | "edit_index" | "is_ipo"> {
  return {
    time: Math.floor(e.ts / 1000),
    edit_index: e.edit_index,
    is_ipo: e.is_ipo,
  };
}

/** 单根 K 线（仅删、仅增、或净变化无分步） */
export function eventToCandle(e: KagentEvent): Candle {
  const open = e.lines_before;
  const close = e.lines_after;
  const { high, low } = clampHighLow(open, close, e.lines_high, e.lines_low);

  return {
    ...candleBase(e),
    open,
    high,
    low,
    close,
    volume: e.added + e.removed,
  };
}

/**
 * 一轮编辑可拆为多根 K 线：同时有删有增时先画下跌（删），再画上涨（增），
 * 而不是仅用 lines_before → lines_after 的净变化。
 */
export function eventToCandles(e: KagentEvent): Candle[] {
  const removed = e.removed ?? 0;
  const added = e.added ?? 0;

  if (removed > 0 && added > 0) {
    const mid = Math.max(0, e.lines_before - removed);
    const dropBounds = clampHighLow(
      e.lines_before,
      mid,
      e.lines_high,
      e.lines_low
    );
    const riseBounds = clampHighLow(mid, e.lines_after, e.lines_high, e.lines_low);

    return [
      {
        ...candleBase(e),
        open: e.lines_before,
        close: mid,
        high: dropBounds.high,
        low: dropBounds.low,
        volume: removed,
        sub_step: 1,
        leg: "drop",
      },
      {
        ...candleBase(e),
        open: mid,
        close: e.lines_after,
        high: riseBounds.high,
        low: riseBounds.low,
        volume: added,
        sub_step: 2,
        leg: "rise",
        is_ipo: false,
      },
    ];
  }

  return [eventToCandle(e)];
}

export function buildCandlesForFile(events: KagentEvent[], file: string): Candle[] {
  return events
    .filter((e) => e.file === file)
    .sort((a, b) => a.edit_index - b.edit_index)
    .flatMap(eventToCandles);
}

/** 最近一次展示 K 线的涨跌（含拆分后的最后一根） */
export function lastEditTrendForFile(
  events: KagentEvent[],
  file: string
): LastEditTrend | null {
  const candles = buildCandlesForFile(events, file);
  if (!candles.length) {
    return null;
  }
  const last = candles[candles.length - 1];
  if (last.close > last.open) {
    return "up";
  }
  if (last.close < last.open) {
    return "down";
  }
  return "flat";
}

export function buildMarketPayload(
  events: KagentEvent[],
  symbolsDoc: SymbolsFile,
  selectedFile: string | null,
  workspaceRoot?: string,
  now = Date.now()
): MarketPayload {
  const candles: Record<string, Candle[]> = {};
  const symbolFiles = new Set(Object.keys(symbolsDoc.symbols));
  const files = new Set<string>(symbolFiles);
  for (const e of events) {
    if (
      symbolFiles.has(e.file) ||
      workspaceRoot == null ||
      !isWorkspaceFileMissing(workspaceRoot, e.file)
    ) {
      files.add(e.file);
    }
  }

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
        is_new: now - ipo_ts < ACTIVITY_WINDOW_MS,
        is_recent:
          now - (info?.last_ts ?? ipo_ts) < ACTIVITY_WINDOW_MS &&
          now - ipo_ts >= ACTIVITY_WINDOW_MS,
        is_delisted:
          info?.delisted === true ||
          (workspaceRoot != null &&
            isWorkspaceFileMissing(workspaceRoot, file) &&
            (info != null || events.some((ev) => ev.file === file))),
      };
    })
    .sort((a, b) => {
      const ad = a.is_delisted ? 1 : 0;
      const bd = b.is_delisted ? 1 : 0;
      if (ad !== bd) {
        return ad - bd;
      }
      return b.last_ts - a.last_ts;
    });

  const active =
    selectedFile && files.has(selectedFile)
      ? selectedFile
      : symbols[0]?.file ?? null;

  if (active) {
    candles[active] = buildCandlesForFile(events, active);
  }

  return { symbols, selectedFile: active, candles };
}
