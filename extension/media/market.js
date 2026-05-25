(function () {
  const vscode = acquireVsCodeApi();

  const BASE_TIME = 1704067200;

  /** 从 CSS 变量读取，保证 K 线填充/边框/影线与侧栏箭头色号一致 */
  function getKagentColors() {
    const root = getComputedStyle(document.documentElement);
    const up = root.getPropertyValue("--kagent-up").trim();
    const down = root.getPropertyValue("--kagent-down").trim();
    const upRgb = root.getPropertyValue("--kagent-up-rgb").trim();
    const downRgb = root.getPropertyValue("--kagent-down-rgb").trim();
    const volAlpha = colorTone === "dark" ? 0.6 : 0.45;
    return {
      up,
      down,
      upVol: `rgba(${upRgb}, ${volAlpha})`,
      downVol: `rgba(${downRgb}, ${volAlpha})`,
    };
  }

  function candlestickSeriesOptions(colors) {
    return {
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: true,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickVisible: true,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    };
  }

  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  const metaByTime = new Map();
  let lastCandles = [];
  let lastSelectedFile = null;
  let colorScheme = "cn";
  let colorTone = "light";
  let schemeSwitchBound = false;
  let toneSwitchBound = false;

  const SCHEME_LEGEND = { cn: "红涨绿跌", us: "绿涨红跌" };

  const els = {
    banner: document.getElementById("banner"),
    symbolList: document.getElementById("symbol-list"),
    symbolCount: document.getElementById("symbol-count"),
    emptyHint: document.getElementById("empty-hint"),
    chartTitle: document.getElementById("chart-title"),
    chartLegend: document.getElementById("chart-legend"),
    schemeSwitch: document.querySelector(
      '.scheme-switch:not(.tone-switch)'
    ),
    toneSwitch: document.querySelector(".tone-switch"),
    chartContainer: document.getElementById("chart-container"),
    chartError: document.getElementById("chart-error"),
    ohlcRound: document.getElementById("ohlc-round"),
    ohlcOpen: document.getElementById("ohlc-open"),
    ohlcHigh: document.getElementById("ohlc-high"),
    ohlcLow: document.getElementById("ohlc-low"),
    ohlcClose: document.getElementById("ohlc-close"),
    ohlcVolume: document.getElementById("ohlc-volume"),
  };

  function formatNet(n) {
    return (n > 0 ? "+" : "") + n;
  }

  function legendText() {
    const market = SCHEME_LEGEND[colorScheme];
    const tone = colorTone === "dark" ? " · 暗色" : "";
    return "开/收=阶段起止行数；同轮先删后增拆为两根K线 · " + market + tone;
  }

  function applyMarketColors(scheme, tone) {
    colorScheme = scheme === "us" ? "us" : "cn";
    colorTone = tone === "dark" ? "dark" : "light";
    document.documentElement.dataset.colorScheme = colorScheme;
    document.documentElement.dataset.colorTone = colorTone;
    document.body.dataset.colorScheme = colorScheme;
    document.body.dataset.colorTone = colorTone;
    els.schemeSwitch?.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scheme === colorScheme);
    });
    els.toneSwitch?.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tone === colorTone);
    });
    if (els.chartLegend) {
      els.chartLegend.textContent = legendText();
    }
    if (candleSeries && lastCandles.length && lastSelectedFile) {
      renderChart(lastSelectedFile, lastCandles);
    } else if (candleSeries) {
      candleSeries.applyOptions(candlestickSeriesOptions(getKagentColors()));
    }
  }

  function bindSchemeSwitch() {
    if (schemeSwitchBound || !els.schemeSwitch) {
      return;
    }
    schemeSwitchBound = true;
    els.schemeSwitch.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.scheme === "us" ? "us" : "cn";
        if (next === colorScheme) {
          return;
        }
        vscode.postMessage({ type: "setColorScheme", scheme: next });
      });
    });
  }

  function bindToneSwitch() {
    if (toneSwitchBound || !els.toneSwitch) {
      return;
    }
    toneSwitchBound = true;
    els.toneSwitch.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.tone === "dark" ? "dark" : "light";
        if (next === colorTone) {
          return;
        }
        vscode.postMessage({ type: "setColorTone", tone: next });
      });
    });
  }

  function showChartError(msg) {
    if (els.chartError) {
      els.chartError.textContent = msg;
      els.chartError.classList.remove("hidden");
    }
  }

  function hideChartError() {
    els.chartError?.classList.add("hidden");
  }

  function candleToBar(c) {
    const open = c.open;
    const close = c.close;
    let high = c.high;
    let low = c.low;
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);
    if (high <= low) {
      high = low + 1;
    }
    return { open, high, low, close };
  }

  function buildSeries(candles) {
    metaByTime.clear();
    const series = [];
    let lastTime = 0;

    candles.forEach((c, i) => {
      const idx = c.edit_index ?? i + 1;
      const sub = c.sub_step ?? 0;
      let time = BASE_TIME + idx * 3600 + sub * 900;
      if (time <= lastTime) {
        time = lastTime + 900;
      }
      lastTime = time;

      const bar = candleToBar(c);
      series.push({
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      metaByTime.set(time, {
        edit_index: idx,
        volume: c.volume,
        is_ipo: c.is_ipo,
        leg: c.leg,
        raw: c,
      });
    });

    return series;
  }

  function setCloseTrendClass(open, close) {
    const item = els.ohlcClose?.closest(".ohlc-item");
    if (!item) {
      return;
    }
    item.classList.remove("ohlc-up", "ohlc-down");
    if (close > open) {
      item.classList.add("ohlc-up");
    } else if (close < open) {
      item.classList.add("ohlc-down");
    }
  }

  function updateOhlcBar(meta) {
    if (!meta) {
      ["ohlcRound", "ohlcOpen", "ohlcHigh", "ohlcLow", "ohlcClose", "ohlcVolume"].forEach(
        (k) => {
          if (els[k]) {
            els[k].textContent = "—";
          }
        }
      );
      setCloseTrendClass(0, 0);
      return;
    }
    const c = meta.raw;
    const legLabel =
      meta.leg === "drop" ? " 删" : meta.leg === "rise" ? " 增" : "";
    els.ohlcRound.textContent =
      String(meta.edit_index) +
      legLabel +
      (meta.is_ipo ? " 上市" : "");
    els.ohlcOpen.textContent = String(c.open);
    els.ohlcHigh.textContent = String(c.high);
    els.ohlcLow.textContent = String(c.low);
    els.ohlcClose.textContent = String(c.close);
    els.ohlcVolume.textContent = String(meta.volume);
    setCloseTrendClass(c.open, c.close);
  }

  function resizeChart() {
    if (!chart || !els.chartContainer) {
      return;
    }
    const w = els.chartContainer.clientWidth;
    const h = els.chartContainer.clientHeight;
    if (w > 0 && h > 0) {
      chart.applyOptions({ width: w, height: h });
    }
  }

  function ensureChart() {
    if (chart) {
      return true;
    }

    if (typeof LightweightCharts === "undefined") {
      showChartError(
        "图表库未加载。请在 extension 目录执行: npm install && npm run compile，然后 Reload Window。"
      );
      return false;
    }

    hideChartError();

    const isDark =
      document.body.classList.contains("vscode-dark") ||
      document.body.classList.contains("vscode-high-contrast");

    const w = Math.max(els.chartContainer.clientWidth, 200);
    const h = Math.max(els.chartContainer.clientHeight, 160);

    chart = LightweightCharts.createChart(els.chartContainer, {
      width: w,
      height: h,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#ccc" : "#333",
      },
      grid: {
        vertLines: { color: isDark ? "#333" : "#eee" },
        horzLines: { color: isDark ? "#333" : "#eee" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });

    const colors = getKagentColors();
    candleSeries = chart.addCandlestickSeries(candlestickSeriesOptions(colors));

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        return;
      }
      const meta = metaByTime.get(param.time);
      if (meta) {
        updateOhlcBar(meta);
      }
    });

    new ResizeObserver(() => resizeChart()).observe(els.chartContainer);
    return true;
  }

  function renderChart(file, candles) {
    lastCandles = candles ?? [];
    els.chartTitle.textContent = file
      ? file + "（" + lastCandles.length + " 根 K 线）"
      : "选择一只股票";

    if (!file || !lastCandles.length) {
      if (candleSeries) {
        candleSeries.setData([]);
        volumeSeries?.setData([]);
      }
      updateOhlcBar(null);
      return;
    }

    if (!ensureChart()) {
      return;
    }

    const colors = getKagentColors();
    candleSeries.applyOptions(candlestickSeriesOptions(colors));

    const series = buildSeries(lastCandles);
    const vol = series.map((bar, i) => {
      const c = lastCandles[i];
      const up = c.close >= c.open;
      return {
        time: bar.time,
        value: c.volume ?? 0,
        color: up ? colors.upVol : colors.downVol,
      };
    });

    candleSeries.setData(series);
    volumeSeries.setData(vol);
    chart.timeScale().fitContent();
    resizeChart();

    const last = series[series.length - 1];
    updateOhlcBar(metaByTime.get(last.time));
  }

  function trendArrowMarkup(trend) {
    if (trend === "up") {
      return '<span class="trend-arrow trend-up" title="上次修改：行数上涨">▲</span>';
    }
    if (trend === "down") {
      return '<span class="trend-arrow trend-down" title="上次修改：行数下跌">▼</span>';
    }
    if (trend === "flat") {
      return '<span class="trend-arrow trend-flat" title="上次修改：行数持平">—</span>';
    }
    return '<span class="trend-arrow trend-none" title="暂无修改记录">·</span>';
  }

  function renderSymbols(symbols, activeFile) {
    els.symbolList.innerHTML = "";
    els.symbolCount.textContent = String(symbols.length);
    els.emptyHint.classList.toggle("hidden", symbols.length > 0);

    for (const s of symbols) {
      const li = document.createElement("li");
      li.className = "symbol-item";
      if (s.file === activeFile) {
        li.classList.add("active");
      }
      if (s.is_new) {
        li.classList.add("ipo");
      }
      li.innerHTML =
        trendArrowMarkup(s.last_trend) +
        '<div class="symbol-body">' +
        '<div class="symbol-name">' +
        escapeHtml(shortName(s.file)) +
        (s.is_new ? '<span class="badge-new">新</span>' : "") +
        "</div><div class=\"symbol-meta\">" +
        s.edit_count +
        " 笔 · " +
        s.last_lines +
        " 行 · 净" +
        formatNet(s.total_net) +
        "</div></div>";
      li.addEventListener("click", () => {
        vscode.postMessage({ type: "selectSymbol", file: s.file });
      });
      els.symbolList.appendChild(li);
    }
  }

  function shortName(file) {
    const p = file.split("/");
    return p.length <= 2 ? file : p.slice(-2).join("/");
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateBanner(payload) {
    if (!payload.hooksOk) {
      els.banner.textContent =
        "未配置 Hooks。命令面板 →「KAgent: 安装项目 Hooks」";
      els.banner.classList.remove("hidden");
      return;
    }
    if (!payload.symbols?.length) {
      els.banner.textContent = "用 Agent 修改文件后，此处会出现股票列表。";
      els.banner.classList.remove("hidden");
      return;
    }
    els.banner.classList.add("hidden");
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "marketUpdate") {
      return;
    }
    const payload = event.data.payload;
    lastSelectedFile = payload.selectedFile ?? null;
    applyMarketColors(payload.colorScheme, payload.colorTone);
    bindSchemeSwitch();
    bindToneSwitch();
    updateBanner(payload);
    renderSymbols(payload.symbols, payload.selectedFile);
    requestAnimationFrame(() => {
      renderChart(payload.selectedFile, payload.candles?.[payload.selectedFile]);
    });
  });

  bindSchemeSwitch();
  bindToneSwitch();
  applyMarketColors(
    document.body.dataset.colorScheme || "cn",
    document.body.dataset.colorTone || "light"
  );
  vscode.postMessage({ type: "ready" });
})();
