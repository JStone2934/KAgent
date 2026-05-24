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
  source: string;
}

export interface SymbolInfo {
  ipo_ts: number;
  edit_count: number;
  last_lines: number;
  last_ts: number;
  delisted?: boolean;
}

export interface SymbolsFile {
  symbols: Record<string, SymbolInfo>;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  edit_index: number;
  is_ipo?: boolean;
}

export interface SymbolSummary {
  file: string;
  ipo_ts: number;
  edit_count: number;
  last_lines: number;
  last_ts: number;
  total_net: number;
  is_new?: boolean;
}

export interface MarketPayload {
  symbols: SymbolSummary[];
  selectedFile: string | null;
  candles: Record<string, Candle[]>;
}
