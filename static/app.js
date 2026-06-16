"use strict";

const API = "/api/records";

// 表格默认预览条数, 超出后折叠并提供"展开全部"
const TABLE_PREVIEW = 30;
let tableExpanded = false;
// 缓存最近一次拉取的记录, 供表格展开/收起复用, 避免重复请求
let lastRecords = [];
// 当前后端所用的移动平均窗口(由接口返回, 决定前端动态渲染列数与曲线数)
let currentWindows = [];

// 体重原始曲线颜色
const WEIGHT_COLOR = "#4f6df5";
// 移动平均曲线调色板, 按窗口顺序循环取用
const MA_PALETTE = ["#f59e0b", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#ef4444"];

/** 按索引取移动平均曲线颜色, 超出调色板长度则循环。 */
function maColor(index) {
    return MA_PALETTE[index % MA_PALETTE.length];
}

/** 返回本地时区今天的 yyyy-mm-dd 字符串。 */
function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** 显示表单提示信息。 */
function showMsg(text, ok) {
    const el = document.getElementById("form-msg");
    el.textContent = text;
    el.className = "form-msg " + (ok ? "ok" : "err");
}

/** 拉取记录并刷新页面。 */
async function loadRecords() {
    const res = await fetch(API);
    const json = await res.json();
    const { records, windows } = json.data;
    lastRecords = records;
    currentWindows = windows || [];
    renderStats(records);
    renderTable(records);
    renderChart(records);
}

/** 渲染顶部统计卡片(随窗口数量动态生成)。 */
function renderStats(records) {
    const card = document.getElementById("stats-card");
    const latest = records[records.length - 1];

    // 卡片: 最新体重 + 每个窗口的均值 + 较最大窗口的差值
    const cells = [];
    cells.push({ label: "最新体重", value: latest ? `${latest.weight.toFixed(2)} kg` : "--" });
    currentWindows.forEach((w) => {
        const v = latest ? latest[`ma_${w}`] : null;
        cells.push({ label: `${w} 日均值`, value: v != null ? `${v.toFixed(2)} kg` : "--" });
    });

    // 差值参照最大(最后一个)窗口
    const maxWindow = currentWindows[currentWindows.length - 1];
    let diffColor = "";
    let diffText = "--";
    if (latest && maxWindow != null && latest[`ma_${maxWindow}`] != null) {
        const diff = latest.weight - latest[`ma_${maxWindow}`];
        const sign = diff > 0 ? "+" : "";
        diffText = `${sign}${diff.toFixed(2)} kg`;
        diffColor = diff > 0 ? "var(--danger)" : "var(--ma7)";
    }
    const diffLabel = maxWindow != null ? `较 ${maxWindow} 日均值` : "较均值";

    card.innerHTML =
        cells
            .map(
                (c) =>
                    `<div class="stat"><span class="stat-label">${c.label}</span>` +
                    `<span class="stat-value">${c.value}</span></div>`
            )
            .join("") +
        `<div class="stat"><span class="stat-label">${diffLabel}</span>` +
        `<span class="stat-value" style="color:${diffColor}">${diffText}</span></div>`;
}

/** 渲染历史记录表格(表头随窗口动态生成)。 */
function renderTable(records) {
    const head = document.getElementById("record-head");
    const body = document.getElementById("record-body");
    const emptyTip = document.getElementById("empty-tip");
    const toggle = document.getElementById("table-toggle");

    // 表头: 日期 / 体重 / 各窗口均值 / 备注 / 操作
    head.innerHTML =
        `<th>日期</th><th>体重 (kg)</th>` +
        currentWindows.map((w) => `<th>${w} 日均值</th>`).join("") +
        `<th>备注</th><th></th>`;

    body.innerHTML = "";
    if (records.length === 0) {
        emptyTip.hidden = false;
        toggle.hidden = true;
        return;
    }
    emptyTip.hidden = true;

    // 倒序(最新在上); 未展开时仅取最近 TABLE_PREVIEW 条
    const ordered = [...records].reverse();
    const visible = tableExpanded ? ordered : ordered.slice(0, TABLE_PREVIEW);

    visible.forEach((r) => {
        const tr = document.createElement("tr");
        const maCells = currentWindows
            .map((w) => `<td>${fmt(r[`ma_${w}`])}</td>`)
            .join("");
        tr.innerHTML = `
            <td>${r.date}</td>
            <td>${r.weight.toFixed(2)}</td>
            ${maCells}
            <td>${r.note ? escapeHtml(r.note) : ""}</td>
            <td><button class="btn-del" data-date="${r.date}">删除</button></td>
        `;
        body.appendChild(tr);
    });
    body.querySelectorAll(".btn-del").forEach((btn) => {
        btn.addEventListener("click", () => deleteRecord(btn.dataset.date));
    });

    // 超出预览条数才显示展开/收起按钮
    if (ordered.length > TABLE_PREVIEW) {
        toggle.hidden = false;
        toggle.textContent = tableExpanded
            ? "收起"
            : `展开全部 (共 ${ordered.length} 条)`;
    } else {
        toggle.hidden = true;
    }
}

/** 数值保留两位小数, 缺失时显示占位符。 */
function fmt(value) {
    return value != null ? value.toFixed(2) : "--";
}

/** 简单的 HTML 转义, 防止备注内容破坏结构。 */
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/** 渲染图例(体重 + 各窗口均值)。 */
function renderLegend() {
    const legend = document.getElementById("chart-legend");
    const items = [`<span class="legend-item"><i class="dot" style="background:${WEIGHT_COLOR}"></i>体重</span>`];
    currentWindows.forEach((w, i) => {
        items.push(
            `<span class="legend-item"><i class="dot" style="background:${maColor(i)}"></i>${w} 日均值</span>`
        );
    });
    legend.innerHTML = items.join("");
}

/** 用内联 SVG 绘制体重与移动平均折线图。 */
function renderChart(records) {
    renderLegend();
    const container = document.getElementById("chart");
    if (records.length === 0) {
        container.innerHTML = "<p class='empty-tip'>暂无数据</p>";
        return;
    }

    const W = Math.max(640, records.length * 48);
    const H = 280;
    const pad = { top: 20, right: 16, bottom: 36, left: 44 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const allVals = [];
    records.forEach((r) => {
        allVals.push(r.weight);
        currentWindows.forEach((w) => {
            if (r[`ma_${w}`] != null) allVals.push(r[`ma_${w}`]);
        });
    });
    let min = Math.min(...allVals);
    let max = Math.max(...allVals);
    if (min === max) {
        min -= 1;
        max += 1;
    }
    const range = max - min;
    min -= range * 0.1;
    max += range * 0.1;

    const n = records.length;
    const x = (i) => pad.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = (v) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

    const line = (key, color) => {
        const pts = records
            .map((r, i) => `${x(i)},${y(r[key])}`)
            .join(" ");
        return `<polyline fill="none" stroke="${color}" stroke-width="2"
            points="${pts}" stroke-linejoin="round" stroke-linecap="round" />`;
    };

    const dots = records
        .map(
            (r, i) =>
                `<circle cx="${x(i)}" cy="${y(r.weight)}" r="3" fill="${WEIGHT_COLOR}">
                    <title>${r.date}: ${r.weight.toFixed(2)}kg</title>
                </circle>`
        )
        .join("");

    // y 轴网格与刻度
    const ticks = 4;
    let grid = "";
    for (let t = 0; t <= ticks; t++) {
        const val = min + ((max - min) * t) / ticks;
        const yy = y(val);
        grid += `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}"
            stroke="#eef1f6" stroke-width="1" />
            <text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end"
            font-size="11" fill="#9ca3af">${val.toFixed(1)}</text>`;
    }

    // x 轴日期(最多显示约 8 个, 避免拥挤)
    const step = Math.ceil(n / 8);
    let xlabels = "";
    records.forEach((r, i) => {
        if (i % step === 0 || i === n - 1) {
            xlabels += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle"
                font-size="11" fill="#9ca3af">${r.date.slice(5)}</text>`;
        }
    });

    // 移动平均曲线(按窗口顺序), 体重曲线绘制在最上层
    const maLines = currentWindows
        .map((w, i) => line(`ma_${w}`, maColor(i)))
        .join("");

    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
            ${grid}
            ${maLines}
            ${line("weight", WEIGHT_COLOR)}
            ${dots}
            ${xlabels}
        </svg>`;

    // 数据较多时自动横向滚动到最新一天(最右侧)
    container.scrollLeft = container.scrollWidth;
}

/** 提交体重记录。 */
async function submitRecord(e) {
    e.preventDefault();
    const date = document.getElementById("date").value;
    const weight = parseFloat(document.getElementById("weight").value);
    const note = document.getElementById("note").value;

    if (!date) {
        showMsg("请选择日期", false);
        return;
    }
    if (!weight || weight <= 0) {
        showMsg("请输入有效的体重", false);
        return;
    }

    const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, weight, note }),
    });
    const json = await res.json();
    if (json.code === 200) {
        showMsg("保存成功 ✓", true);
        document.getElementById("note").value = "";
        await loadRecords();
    } else {
        showMsg(json.message || "保存失败", false);
    }
}

/** 删除指定日期的记录。 */
async function deleteRecord(date) {
    if (!confirm(`确认删除 ${date} 的记录?`)) return;
    const res = await fetch(`${API}/${date}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code === 200) {
        await loadRecords();
    } else {
        alert(json.message || "删除失败");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("date").value = todayStr();
    document.getElementById("record-form").addEventListener("submit", submitRecord);
    document.getElementById("table-toggle").addEventListener("click", () => {
        tableExpanded = !tableExpanded;
        renderTable(lastRecords);
    });
    loadRecords();
});
