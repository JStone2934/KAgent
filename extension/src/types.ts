export type KagentEventSource = "afterFileEdit" | "onSave" | "simulate" | string;
export type KagentEventActor = "agent" | "human" | "unknown";

export interface KagentEvent {
  v: number;
  ts: number;
  conversation_id: string | null;
  generation_id: string | null;
  file: string;
  added: number;
  removed: number;
  net: number;
  lines_before: number;
  lines_after: number;
  /** 本轮修改过程中触及的最高行数（K 线最高价） */
  lines_high?: number;
  /** 本轮修改过程中触及的最低行数（K 线最低价） */
  lines_low?: number;
  is_ipo: boolean;
  edit_index: number;
  source: KagentEventSource;
  actor?: KagentEventActor;
  editor?: string;
  save_reason?: string;
  content_hash_after?: string;
}

export interface SymbolInfo {
  ipo_ts: number;
  edit_count: number;
  last_lines: number;
  last_ts: number;
  delisted?: boolean;
  last_source?: string;
  last_content_hash?: string;
}

export interface SymbolsFile {
  symbols: Record<string, SymbolInfo>;
}

/** 同一轮编辑拆分后的阶段：先删后增 */
export type CandleLeg = "drop" | "rise";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  edit_index: number;
  is_ipo?: boolean;
  /** 同轮编辑内的子 K 线序号（1=先删，2=后增） */
  sub_step?: number;
  leg?: CandleLeg;
}

/** 最近一次编辑相对上一状态的涨跌（与 K 线阴阳一致：收≥开为涨） */
export type LastEditTrend = "up" | "down" | "flat";

export interface SymbolSummary {
  file: string;
  ipo_ts: number;
  edit_count: number;
  last_lines: number;
  last_ts: number;
  total_net: number;
  /** 上次修改涨势，无事件时为 null */
  last_trend: LastEditTrend | null;
  /** 上市不久（与 ipo_ts 间隔在窗口内） */
  is_new?: boolean;
  /** 刚刚发生过编辑（与 last_ts 间隔在窗口内，且非 is_new） */
  is_recent?: boolean;
}

export interface MarketPayload {
  symbols: SymbolSummary[];
  selectedFile: string | null;
  candles: Record<string, Candle[]>;
}
