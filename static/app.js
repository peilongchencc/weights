"use strict";

const API = "/api/records";

// 每页最多展示的记录条数
const PAGE_SIZE = 30;
// 当前页码(从 1 开始); 记录按日期倒序, 故第 1 页为最新数据
let currentPage = 1;
// 正在内联编辑的记录日期; null 表示无编辑中行
let editingDate = null;
// 缓存最近一次拉取的记录, 供分页/编辑复用, 避免重复请求
let lastRecords = [];
// 当前后端所用的移动平均窗口(由接口返回, 决定前端动态渲染列数与曲线数)
let currentWindows = [];

// 操作列图标(内联 SVG, 16x16, 继承 currentColor)
const ICON_EDIT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
const ICON_SAVE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_CANCEL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';

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

/** 渲染历史记录表格(表头随窗口动态生成, 支持分页与内联编辑)。 */
function renderTable(records) {
    const head = document.getElementById("record-head");
    const body = document.getElementById("record-body");
    const emptyTip = document.getElementById("empty-tip");
    const pager = document.getElementById("pager");

    // 表头: 日期 / 体重 / 各窗口均值 / 备注 / 操作
    head.innerHTML =
        `<th>日期</th><th>体重 (kg)</th>` +
        currentWindows.map((w) => `<th>${w} 日均值</th>`).join("") +
        `<th>备注</th><th>操作</th>`;

    body.innerHTML = "";
    if (records.length === 0) {
        emptyTip.hidden = false;
        pager.hidden = true;
        return;
    }
    emptyTip.hidden = true;

    // 倒序(最新在上)
    const ordered = [...records].reverse();
    const totalPages = Math.ceil(ordered.length / PAGE_SIZE);
    // 越界保护(如删除后当前页已无数据)
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = ordered.slice(start, start + PAGE_SIZE);

    visible.forEach((r) => {
        const tr = document.createElement("tr");
        const maCells = currentWindows
            .map((w) => `<td>${fmt(r[`ma_${w}`])}</td>`)
            .join("");
        if (r.date === editingDate) {
            tr.className = "editing";
            tr.innerHTML = `
                <td>${r.date}</td>
                <td><input class="edit-input edit-weight" type="number" step="0.01" min="0.1" value="${r.weight}" /></td>
                ${maCells}
                <td><input class="edit-input edit-note" type="text" maxlength="500" value="${escapeAttr(r.note)}" placeholder="备注" /></td>
                <td>
                    <div class="action-cell">
                        <button class="icon-btn btn-save" data-date="${r.date}" title="保存">${ICON_SAVE}</button>
                        <button class="icon-btn btn-cancel" data-date="${r.date}" title="取消">${ICON_CANCEL}</button>
                    </div>
                </td>
            `;
        } else {
            const noteText = r.note ? escapeHtml(r.note) : "";
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${r.weight.toFixed(2)}</td>
                ${maCells}
                <td class="note-cell" title="${escapeAttr(r.note)}">${noteText}</td>
                <td>
                    <div class="action-cell">
                        <button class="icon-btn btn-edit" data-date="${r.date}" title="编辑">${ICON_EDIT}</button>
                        <button class="icon-btn btn-del" data-date="${r.date}" title="删除">${ICON_DELETE}</button>
                    </div>
                </td>
            `;
        }
        body.appendChild(tr);
    });

    bindRowActions(body);
    renderPager(ordered.length, totalPages);
}

/** 绑定当前页行内的编辑/删除/保存/取消事件。 */
function bindRowActions(body) {
    body.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.addEventListener("click", () => startEdit(btn.dataset.date));
    });
    body.querySelectorAll(".btn-del").forEach((btn) => {
        btn.addEventListener("click", () => deleteRecord(btn.dataset.date));
    });
    body.querySelectorAll(".btn-save").forEach((btn) => {
        btn.addEventListener("click", () => saveEdit(btn.dataset.date));
    });
    body.querySelectorAll(".btn-cancel").forEach((btn) => {
        btn.addEventListener("click", () => cancelEdit());
    });
    // 编辑状态下按回车保存, 按 Esc 取消
    body.querySelectorAll(".edit-input").forEach((input) => {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveEdit(editingDate);
            else if (e.key === "Escape") cancelEdit();
        });
    });
}

/** 渲染分页控件(仅一页时仍显示, 便于查看总条数)。 */
function renderPager(total, totalPages) {
    const pager = document.getElementById("pager");
    const info = document.getElementById("page-info");
    const prev = document.getElementById("page-prev");
    const next = document.getElementById("page-next");

    pager.hidden = false;
    info.textContent = `第 ${currentPage} / ${totalPages} 页 · 共 ${total} 条`;
    prev.disabled = currentPage <= 1;
    next.disabled = currentPage >= totalPages;
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

/** 属性值转义, 在 escapeHtml 基础上额外转义引号, 供 title 等属性安全使用。 */
function escapeAttr(str) {
    if (!str) return "";
    return escapeHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
        .map((r, i) => `<circle cx="${x(i)}" cy="${y(r.weight)}" r="3" fill="${WEIGHT_COLOR}" />`)
        .join("");

    // 各曲线序列(体重 + 各窗口均值), 用于高亮点与提示内容
    const series = [
        { key: "weight", color: WEIGHT_COLOR },
        ...currentWindows.map((w, i) => ({ key: `ma_${w}`, color: maColor(i) })),
    ];

    // 悬停高亮点(初始隐藏, 交互时按当前数据点更新位置)
    const activeDots = series
        .map(
            (s) =>
                `<circle class="active-dot" data-key="${s.key}" r="5" fill="${s.color}"` +
                ` stroke="#fff" stroke-width="2" visibility="hidden" />`
        )
        .join("");

    // 透明的整列命中区(覆盖全高), 扩大悬停/点击的可触发范围
    const hits = records
        .map((r, i) => {
            const left = i === 0 ? pad.left : (x(i - 1) + x(i)) / 2;
            const right = i === n - 1 ? W - pad.right : (x(i) + x(i + 1)) / 2;
            return (
                `<rect class="hit" x="${left}" y="${pad.top}" width="${Math.max(right - left, 1)}"` +
                ` height="${innerH}" fill="transparent" data-i="${i}" />`
            );
        })
        .join("");

    // 悬停参考线(初始隐藏, 交互时移动到当前列)
    const guide =
        `<line class="chart-guide" y1="${pad.top}" y2="${pad.top + innerH}"` +
        ` stroke="#cbd2e0" stroke-width="1" stroke-dasharray="4 3" visibility="hidden" />`;

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
            ${guide}
            ${maLines}
            ${line("weight", WEIGHT_COLOR)}
            ${dots}
            ${activeDots}
            ${xlabels}
            ${hits}
        </svg>
        <div class="chart-tooltip" hidden></div>`;

    attachChartInteraction(container, records, x, y, W);

    // 数据较多时自动横向滚动到最新一天(最右侧)
    container.scrollLeft = container.scrollWidth;
}

/** 构造图表悬浮提示的 HTML(日期 + 体重 + 各窗口均值)。 */
function buildChartTip(r) {
    const rows = [
        `<div class="tip-row"><i class="tip-dot" style="background:${WEIGHT_COLOR}"></i>` +
            `体重 <b>${r.weight.toFixed(2)}</b> kg</div>`,
    ];
    currentWindows.forEach((w, i) => {
        const v = r[`ma_${w}`];
        const valText = v != null ? `${v.toFixed(2)} kg` : "--";
        rows.push(
            `<div class="tip-row"><i class="tip-dot" style="background:${maColor(i)}"></i>` +
                `${w} 日均值 <b>${valText}</b></div>`
        );
    });
    return `<div class="tip-date">${r.date}</div>${rows.join("")}`;
}

/** 绑定图表交互: 悬停/点击整列时显示参考线、高亮点与数据浮层。 */
function attachChartInteraction(container, records, x, y, W) {
    const svg = container.querySelector("svg");
    const tip = container.querySelector(".chart-tooltip");
    const guide = container.querySelector(".chart-guide");
    const activeDots = container.querySelectorAll(".active-dot");
    if (!svg || !tip) return;

    const showAt = (i) => {
        const r = records[i];
        if (!r) return;
        tip.innerHTML = buildChartTip(r);
        tip.hidden = false;

        if (guide) {
            guide.setAttribute("x1", x(i));
            guide.setAttribute("x2", x(i));
            guide.setAttribute("visibility", "visible");
        }
        activeDots.forEach((dot) => {
            const v = r[dot.dataset.key];
            if (v == null) {
                dot.setAttribute("visibility", "hidden");
                return;
            }
            dot.setAttribute("cx", x(i));
            dot.setAttribute("cy", y(v));
            dot.setAttribute("visibility", "visible");
        });

        // 定位浮层: 默认在数据点上方居中, 空间不足则翻转到下方, 并做左右夹取
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = x(i) - tw / 2;
        left = Math.max(4, Math.min(left, W - tw - 4));
        let top = y(r.weight) - th - 12;
        if (top < 4) top = y(r.weight) + 14;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    };

    const hide = () => {
        tip.hidden = true;
        if (guide) guide.setAttribute("visibility", "hidden");
        activeDots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
    };

    svg.querySelectorAll(".hit").forEach((rect) => {
        const i = Number(rect.dataset.i);
        rect.addEventListener("mouseenter", () => showAt(i));
        rect.addEventListener("click", () => showAt(i));
    });
    svg.addEventListener("mouseleave", hide);
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
        // 新增/更新后回到第 1 页, 便于查看最新记录
        currentPage = 1;
        editingDate = null;
        await loadRecords();
    } else {
        showMsg(json.message || "保存失败", false);
    }
}

/** 进入某条记录的内联编辑状态。 */
function startEdit(date) {
    editingDate = date;
    renderTable(lastRecords);
    // 聚焦体重输入框, 便于直接修改
    const input = document.querySelector("tr.editing .edit-weight");
    if (input) input.focus();
}

/** 取消编辑, 恢复只读展示。 */
function cancelEdit() {
    editingDate = null;
    renderTable(lastRecords);
}

/** 保存内联编辑的体重与备注(复用 upsert 接口, 按日期覆盖)。 */
async function saveEdit(date) {
    const row = document.querySelector("tr.editing");
    if (!row) return;
    const weight = parseFloat(row.querySelector(".edit-weight").value);
    const note = row.querySelector(".edit-note").value;

    if (!weight || weight <= 0) {
        alert("请输入有效的体重");
        return;
    }

    const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, weight, note }),
    });
    const json = await res.json();
    if (json.code === 200) {
        editingDate = null;
        await loadRecords();
    } else {
        alert(json.message || "保存失败");
    }
}

/** 删除指定日期的记录。 */
async function deleteRecord(date) {
    if (!confirm(`确认删除 ${date} 的记录?`)) return;
    const res = await fetch(`${API}/${date}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code === 200) {
        // 删除编辑中的行时一并退出编辑态
        if (editingDate === date) editingDate = null;
        await loadRecords();
    } else {
        alert(json.message || "删除失败");
    }
}

/** 翻页并重新渲染表格(切页时退出编辑态)。 */
function goToPage(page) {
    currentPage = page;
    editingDate = null;
    renderTable(lastRecords);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("date").value = todayStr();
    document.getElementById("record-form").addEventListener("submit", submitRecord);
    document.getElementById("page-prev").addEventListener("click", () => {
        if (currentPage > 1) goToPage(currentPage - 1);
    });
    document.getElementById("page-next").addEventListener("click", () => {
        goToPage(currentPage + 1);
    });
    loadRecords();
});
