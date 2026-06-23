"use strict";

const API = "/api/records";
const PROFILE_API = "/api/profile";
const TARGET_API = "/api/profile/target";

// 当前身高(cm); null 表示尚未设置。用于计算 BMI。
let profileHeight = null;
// 尚未设置身高时, 进入编辑默认预填的身高(cm), 让步进器从合理值起步而非 min。
const DEFAULT_HEIGHT_CM = 175;

// 目标体重(kg)与减重起点日期(yyyy-mm-dd); null 表示尚未设置。
let profileTarget = null;
let profileTargetStart = null;
// 达标/维持判定的区间半宽(kg): 最大窗口均值进入 [目标-band, 目标+band] 即视为达标,
// 之后统计卡从"减重进度"切换为"维持情况", 使目标达成后该卡片仍有效。
// 由后端 .env(TARGET_BAND) 经 /api/records 下发; 此处仅作请求前的默认兜底值。
let TARGET_BAND = 1.0;

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

/** 格式化目标体重为 "70.00 kg"(统一保留两位小数, 与其他体重展示一致)。 */
function fmtKg(value) {
    return `${Number(value).toFixed(2)} kg`;
}

/** 返回本地时区今天的 yyyy-mm-dd 字符串。 */
function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * 禁止「点击 label 文字聚焦其关联输入框」的默认行为。

 * 原生 label[for] 被点击时浏览器会把焦点转发给关联控件, 导致点击输入框上方的标题文字
 * 也会选中/聚焦输入框(日期框还会高亮变蓝), 让用户困惑。这里统一拦截全页带 for 的 label
 * 点击默认行为; for 关联保留, 不影响屏幕阅读器无障碍。
 */
function disableLabelClickFocus() {
    document.querySelectorAll("label[for]").forEach((label) => {
        label.addEventListener("click", (e) => e.preventDefault());
    });
}

/** 显示表单提示信息。 */
function showMsg(text, ok) {
    const el = document.getElementById("form-msg");
    el.textContent = text;
    el.className = "form-msg " + (ok ? "ok" : "err");
}

/**
 * 按日期在缓存记录中查找对应记录。

 * Args:
 *     date: yyyy-mm-dd 格式的日期字符串。

 * Returns:
 *     object|null: 命中的记录对象, 未找到时返回 null。
 */
function findRecordByDate(date) {
    return lastRecords.find((r) => r.date === date) || null;
}

/**
 * 根据所选日期是否已有记录, 更新提交按钮文案与覆盖提示。

 * 已有记录时按钮显示 "更新记录" 并提示再次提交将覆盖, 提醒用户避免误覆盖;
 * 未记录或切到空白日期时恢复为 "保存记录" 并隐藏提示。
 */
function updateFormState() {
    const dateInput = document.getElementById("date");
    const submitBtn = document.getElementById("submit-btn");
    const hint = document.getElementById("date-hint");
    if (!dateInput || !submitBtn || !hint) return;

    const date = dateInput.value;
    const existing = date ? findRecordByDate(date) : null;
    if (existing) {
        submitBtn.textContent = "更新记录";
        const weightText = existing.weight.toFixed(2);
        hint.textContent =
            date === todayStr()
                ? `今日已记录体重为: ${weightText} kg，再次提交将覆盖。`
                : `该日期已记录体重为: ${weightText} kg，再次提交将覆盖。`;
        hint.hidden = false;
    } else {
        submitBtn.textContent = "保存记录";
        hint.hidden = true;
    }
}

/** 拉取记录并刷新页面。 */
async function loadRecords() {
    const res = await fetch(API);
    const json = await res.json();
    const { records, windows, target_band } = json.data;
    lastRecords = records;
    currentWindows = windows || [];
    if (target_band != null) TARGET_BAND = target_band;
    renderStats(records);
    renderTable(records);
    renderChart(records);
    // 记录变化后, 同步刷新提交按钮文案与覆盖提示
    updateFormState();
}

/**
 * 按中国成人 BMI 区间返回对应的颜色与分类标签。

 * Args:
 *     bmi: 身体质量指数数值。

 * Returns:
 *     dict: 含 color(CSS 变量)与 category(中文分类)两个字段。
 */
function bmiCategory(bmi) {
    if (bmi < 18.5) return { color: "#38bdf8", category: "偏瘦" };
    if (bmi < 24) return { color: "var(--ma7)", category: "正常" };
    if (bmi < 28) return { color: "var(--ma3)", category: "超重" };
    return { color: "var(--danger)", category: "肥胖" };
}

/**
 * 取某条记录的"最大窗口均值"作为该日的稳健体重值; 无均值时回退到当日体重。

 * Args:
 *     record: 单条体重记录。
 *     key: 最大窗口的均值字段名(如 "ma_7"), 为 null 时直接用体重。

 * Returns:
 *     number: 用于比较/计算的体重值。
 */
function steadyWeight(record, key) {
    if (key && record[key] != null) return record[key];
    return record.weight;
}

/**
 * 定位起点日期对应的均值: 取该日(或其之前最近一条)记录的最大窗口均值。

 * 用均值而非单日体重作为起点, 可避免起点当天的称重噪声影响整段进度。

 * Args:
 *     records: 升序(最新在末尾)的记录数组。
 *     key: 最大窗口均值字段名。
 *     date: 起点日期 yyyy-mm-dd。

 * Returns:
 *     number: 起点均值; 起点早于所有记录时回退到最早一条。
 */
function avgAtDate(records, key, date) {
    let chosen = null;
    for (const r of records) {
        if (r.date <= date) chosen = r;
        else break;
    }
    if (!chosen) chosen = records[0];
    return steadyWeight(chosen, key);
}

/**
 * 计算两个 yyyy-mm-dd 日期相差的自然日数(toDate 减 fromDate)。

 * 与按"记录条数"计数不同, 这里按本地自然日计算, 即便中间有缺记的日期也能
 * 反映真实的天数跨度。

 * Args:
 *     fromDate: 起始日期字符串。
 *     toDate: 结束日期字符串。

 * Returns:
 *     number: 自然日差; 同一天为 0。
 */
function daysBetween(fromDate, toDate) {
    const a = new Date(`${fromDate}T00:00:00`);
    const b = new Date(`${toDate}T00:00:00`);
    return Math.round((b - a) / 86400000);
}

/**
 * 将 yyyy-mm-dd 日期按自然日偏移指定天数。
 *
 * 用于定位"上一期"的日期(例如 maxW 天前), 配合 avgAtDate 取上期均值做周环比。
 *
 * Args:
 *     date: 基准日期字符串 yyyy-mm-dd。
 *     deltaDays: 偏移天数, 负值表示往前。
 *
 * Returns:
 *     string: 偏移后的日期字符串 yyyy-mm-dd。
 */
function shiftDate(date, deltaDays) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** 生成统计卡中"目标进度"复合格(三行: 标签 / 主数值 / 副信息)的 HTML。 */
function goalCellHtml(valueHtml, sub, help) {
    return (
        `<div class="stat stat-goal">` +
        `<span class="stat-label">目标进度${helpMarkup(help)}</span>` +
        `<span class="stat-value">${valueHtml}</span>` +
        `<span class="stat-sub">${sub}</span></div>`
    );
}

/**
 * 构建"目标进度"格: 随阶段自适应。

 * 未达标(减重期): 展示"已减 X kg"与"进度 X%";
 * 已进入目标 ±band 区间(维持期/达标): 切换为"偏离 ±X kg"与"已维持 N 天",
 * 使减到目标后该卡片依旧有效。判定与计算均基于最大窗口均值, 而非单日体重。

 * Args:
 *     records: 升序记录数组。

 * Returns:
 *     string: 目标进度格的 HTML。
 */
function buildGoalCell(records) {
    if (profileTarget == null) {
        return goalCellHtml(
            "--",
            "在上方设置目标体重",
            "设置目标体重与起点日期后, 这里会展示减重进度; 到达目标后自动切换为维持情况。"
        );
    }

    const target = profileTarget;
    const latest = records[records.length - 1];
    if (!latest) {
        return goalCellHtml("--", `目标 ${fmtKg(target)}`, "暂无体重记录, 录入后展示进度。");
    }

    const maxW = currentWindows[currentWindows.length - 1];
    const key = maxW != null ? `ma_${maxW}` : null;
    const avgLabel = maxW != null ? `${maxW} 日均值` : "体重";
    const curAvg = steadyWeight(latest, key);
    const startAvg = profileTargetStart
        ? avgAtDate(records, key, profileTargetStart)
        : steadyWeight(records[0], key);

    const reached = curAvg <= target + TARGET_BAND;

    if (!reached) {
        // 减重期: 已减 = 起点均值 − 当前均值; 进度 = 已减 / (起点 − 目标)
        const lost = startAvg - curAvg;
        const totalToLose = startAvg - target;
        let progress = totalToLose > 0 ? (lost / totalToLose) * 100 : 0;
        progress = Math.max(0, Math.min(100, progress));
        const gained = lost < 0;
        const mainText = gained
            ? `已增 ${Math.abs(lost).toFixed(2)} kg`
            : `已减 ${lost.toFixed(2)} kg`;
        const color = gained ? "var(--danger)" : "var(--ma7)";
        const help =
            `已减 = 起点${avgLabel} 减 当前${avgLabel}; 进度 = 已减 / (起点 减 目标)。\n` +
            `起点取 ${profileTargetStart || records[0].date} 的${avgLabel} ` +
            `${startAvg.toFixed(2)} kg, 当前${avgLabel} ${curAvg.toFixed(2)} kg。\n` +
            `用均值而非单日体重, 避免单日波动误判。`;
        return goalCellHtml(
            `<span style="color:${color}">${mainText}</span>`,
            `进度 ${progress.toFixed(2)}% · 目标 ${fmtKg(target)}`,
            help
        );
    }

    // 维持期/达标: 偏离 = 当前均值 − 目标(可正可负);
    // 已维持 = 从"最近一段连续 ≤ 目标+band"的起点到最新记录的自然日跨度(按日历天而非记录条数)
    const dev = curAvg - target;
    const devText = `偏离 ${dev > 0 ? "+" : ""}${dev.toFixed(2)} kg`;
    let streakStartDate = latest.date;
    for (let i = records.length - 1; i >= 0; i--) {
        if (steadyWeight(records[i], key) <= target + TARGET_BAND) {
            streakStartDate = records[i].date;
        } else {
            break;
        }
    }
    const maintainDays = daysBetween(streakStartDate, latest.date) + 1;
    const help =
        `当前${avgLabel} ${curAvg.toFixed(2)} kg 已进入目标 ±${TARGET_BAND} kg 区间, 视为达标。\n` +
        `偏离 = 当前${avgLabel} 减 目标; 已维持 = 从最近一次进入 目标+${TARGET_BAND} kg 区间起到最新记录的自然天数(按日历计)。`;
    return goalCellHtml(
        `<span style="color:var(--ma7)">${devText}</span>`,
        `已维持 ${maintainDays} 天 · 目标 ${fmtKg(target)}`,
        help
    );
}

/** 渲染顶部统计卡片(随窗口数量动态生成)。 */
function renderStats(records) {
    const card = document.getElementById("stats-card");
    const latest = records[records.length - 1];

    // 卡片: 目标进度 + 每个窗口的均值 + 最大窗口均值的周环比(较上一期同窗口均值)
    // (最新体重噪声大, 已由"目标进度"与各窗口均值替代, 不再单独展示)
    const cells = [];
    currentWindows.forEach((w) => {
        const v = latest ? latest[`ma_${w}`] : null;
        cells.push({
            label: `${w} 日均值`,
            value: v != null ? `${v.toFixed(2)} kg` : "--",
            help:
                `最近 ${w} 条记录(含今日)的平均值, 即移动平均。\n` +
                `与趋势图中对应的均值曲线一致。\n` +
                `注: 记录不足 ${w} 条时, 按已有的全部记录计算。`,
        });
    });

    // 周环比: 当前 N 日均值 较 "N 天前的 N 日均值"(N 取最大窗口); 两边均为均值, 不受单日噪声影响
    const maxWindow = currentWindows[currentWindows.length - 1];
    let diffColor = "";
    let diffText = "--";
    if (latest && maxWindow != null) {
        const key = `ma_${maxWindow}`;
        // 上一期日期 = 最新日期往前 maxWindow 个自然日
        const prevDate = shiftDate(latest.date, -maxWindow);
        // 仅当存在不晚于上一期日期的更早记录时才对比, 否则视为上期数据不足, 显示 --
        const hasPrev = records.some((r) => r !== latest && r.date <= prevDate);
        if (hasPrev) {
            const curAvg = steadyWeight(latest, key);
            // avgAtDate 天然处理缺记: 回退到该日期前最近一条记录的均值
            const prevAvg = avgAtDate(records, key, prevDate);
            const diff = curAvg - prevAvg;
            const sign = diff > 0 ? "+" : "";
            diffText = `${sign}${diff.toFixed(2)} kg`;
            diffColor = diff > 0 ? "var(--danger)" : "var(--ma7)";
        }
    }
    // 偏移天数等于窗口大小; 默认 7 时"上周"严格成立, 其它窗口回退为通用表述
    const diffLabel =
        maxWindow == null
            ? "较上期均值"
            : maxWindow === 7
              ? "较上周 7 日均值"
              : `较上一 ${maxWindow} 日均值`;
    const helpText =
        maxWindow != null
            ? `当前 ${maxWindow} 日均值 减去 ${maxWindow} 天前的 ${maxWindow} 日均值。\n` +
              `两边均为均值(非单日体重), 按日历日定位上期, 缺记时取该日前最近一条记录的均值。\n` +
              `正值(红色)表示较上期变重, 负值(绿色)表示较上期变轻。\n` +
              `注: 记录不足约两周时, 上期均值按当时已有记录计算(窗口可能不满, 早期偏噪声);\n` +
              `完全缺少早于上期日期的记录(约不足一周)时显示 --。`
            : "当前均值相较上一期均值的变化。";

    // BMI 卡片: 仅在已设置身高且有最新体重时展示
    if (profileHeight != null && latest) {
        const m = profileHeight / 100;
        // 用最大窗口均值(默认 7 日均值)而非单日体重计算, 避免单日称重噪声影响 BMI;
        // 记录不足或无窗口时, steadyWeight 自动回退到最新单日体重。
        const bmiKey = maxWindow != null ? `ma_${maxWindow}` : null;
        const bmiWeight = steadyWeight(latest, bmiKey);
        const bmiAvgLabel = maxWindow != null ? `${maxWindow} 日均值` : "最新体重";
        const bmi = bmiWeight / (m * m);
        const { color, category } = bmiCategory(bmi);
        cells.push({
            label: "BMI",
            value:
                `${bmi.toFixed(1)}` +
                `<span class="stat-tag" style="color:${color}">${category}</span>`,
            color,
            helpHtml:
                `身体质量指数 = 体重(kg) / 身高(m)²。<br>` +
                `当前以${bmiAvgLabel} ${bmiWeight.toFixed(2)} kg 与身高 ${profileHeight} cm 计算。<br>` +
                `参考(中国成人):<br>` +
                `<span style="color:#38bdf8">● 偏瘦 &lt;18.5</span><br>` +
                `<span style="color:var(--ma7)">● 正常 18.5-23.9</span><br>` +
                `<span style="color:var(--ma3)">● 超重 24-27.9</span><br>` +
                `<span style="color:var(--danger)">● 肥胖 ≥28</span>`,
        });
    }

    card.innerHTML =
        `<div class="stat">` +
        `<span class="stat-label">${diffLabel}${helpMarkup(helpText)}</span>` +
        `<span class="stat-value" style="color:${diffColor}">${diffText}</span></div>` +
        cells
            .map(
                (c) =>
                    `<div class="stat"><span class="stat-label">${c.label}${helpMarkup(c.helpHtml || c.help, !!c.helpHtml)}</span>` +
                    `<span class="stat-value"${c.color ? ` style="color:${c.color}"` : ""}>${c.value}</span></div>`
            )
            .join("") +
        buildGoalCell(records);
}

/** 显示个人档案区的提示信息。 */
function showProfileMsg(text, ok) {
    const el = document.getElementById("profile-msg");
    el.textContent = text;
    el.className = "profile-msg " + (ok ? "ok" : "err");
}

/** 拉取个人档案(身高 + 目标体重)并刷新展示。 */
async function loadProfile() {
    const res = await fetch(PROFILE_API);
    const json = await res.json();
    const data = json.data || {};
    profileHeight = data.height_cm != null ? data.height_cm : null;
    profileTarget = data.target_weight != null ? data.target_weight : null;
    profileTargetStart = data.target_start_date || null;
    renderProfile();
    renderTargetProfile();
    // 记录可能已先行加载完成, 此时需重算统计卡以显示 BMI 与目标进度
    if (lastRecords.length > 0) renderStats(lastRecords);
}

/** 渲染个人档案的只读展示。 */
function renderProfile() {
    const el = document.getElementById("profile-height");
    el.textContent = profileHeight != null ? `${profileHeight} cm` : "--";
}

/** 渲染目标体重的只读展示(目标值 + 起点日期)。 */
function renderTargetProfile() {
    const wEl = document.getElementById("target-weight-display");
    const sEl = document.getElementById("target-start-display");
    wEl.textContent = profileTarget != null ? fmtKg(profileTarget) : "--";
    sEl.textContent = profileTargetStart ? `· 起点 ${profileTargetStart.slice(5)}` : "";
}

/** 进入身高编辑状态(只读视图与编辑表单互斥显示)。 */
function startProfileEdit() {
    document.getElementById("profile-view").hidden = true;
    document.getElementById("profile-edit").hidden = false;
    const input = document.getElementById("height");
    // 未设置过身高时预填默认值, 避免步进器从 min(50) 起步
    input.value = profileHeight != null ? profileHeight : DEFAULT_HEIGHT_CM;
    input.focus();
    input.select();
}

/** 退出身高编辑状态, 恢复只读展示。 */
function cancelProfileEdit() {
    document.getElementById("profile-edit").hidden = true;
    document.getElementById("profile-view").hidden = false;
    showProfileMsg("", true);
}

/** 提交身高(PUT /api/profile), 成功后刷新档案与统计卡(BMI)。 */
async function submitProfile(e) {
    e.preventDefault();
    const height = parseFloat(document.getElementById("height").value);
    if (!height || height < 50 || height > 300) {
        showProfileMsg("请输入有效身高(50-300 cm)", false);
        return;
    }

    const res = await fetch(PROFILE_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ height_cm: height }),
    });
    const json = await res.json();
    if (json.code === 200) {
        profileHeight = json.data.height_cm;
        // 只读视图直接更新为新身高, 即为保存成功的反馈, 无需额外提示
        renderProfile();
        cancelProfileEdit();
        // 身高变化会影响 BMI, 重新渲染统计卡
        renderStats(lastRecords);
    } else {
        showProfileMsg(json.message || "保存失败", false);
    }
}

/** 显示目标体重编辑区的提示信息。 */
function showTargetMsg(text, ok) {
    const el = document.getElementById("target-msg");
    el.textContent = text;
    el.className = "profile-msg " + (ok ? "ok" : "err");
}

/** 进入目标体重编辑状态(只读视图与编辑表单互斥显示)。 */
function startTargetEdit() {
    document.getElementById("target-view").hidden = true;
    document.getElementById("target-edit").hidden = false;
    const wInput = document.getElementById("target-weight");
    const sInput = document.getElementById("target-start");
    wInput.value = profileTarget != null ? profileTarget : "";
    // 起点默认: 已设置则沿用(避免改目标时误移基线), 否则取今天(即设定目标当天)
    sInput.value = profileTargetStart || todayStr();
    wInput.focus();
    wInput.select();
}

/** 退出目标体重编辑状态, 恢复只读展示。 */
function cancelTargetEdit() {
    document.getElementById("target-edit").hidden = true;
    document.getElementById("target-view").hidden = false;
    showTargetMsg("", true);
}

/** 提交目标体重与起点日期(PUT /api/profile/target), 成功后刷新统计卡。 */
async function submitTarget(e) {
    e.preventDefault();
    const weight = parseFloat(document.getElementById("target-weight").value);
    const start = document.getElementById("target-start").value;
    if (!weight || weight <= 0) {
        showTargetMsg("请输入有效的目标体重", false);
        return;
    }
    if (!start) {
        showTargetMsg("请选择起点日期", false);
        return;
    }

    const res = await fetch(TARGET_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_weight: weight, target_start_date: start }),
    });
    const json = await res.json();
    if (json.code === 200) {
        profileTarget = json.data.target_weight;
        profileTargetStart = json.data.target_start_date;
        renderTargetProfile();
        cancelTargetEdit();
        // 目标或起点变化会影响进度, 重新渲染统计卡
        renderStats(lastRecords);
    } else {
        showTargetMsg(json.message || "保存失败", false);
    }
}

/** 生成 "?" 帮助按钮与浮层的 HTML; 无说明文本时返回空串。 */
function helpMarkup(text, isHtml = false) {
    if (!text) return "";
    const body = isHtml ? text : escapeHtml(text);
    return (
        `<span class="help"><button type="button" class="help-btn" aria-label="说明">?</button>` +
        `<span class="help-pop" role="tooltip">${body}</span></span>`
    );
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
            const noteCell = r.note
                ? `<td class="note-cell" data-note="${escapeAttr(r.note)}"><span class="note-text">${escapeHtml(r.note)}</span></td>`
                : `<td class="note-cell"></td>`;
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${r.weight.toFixed(2)}</td>
                ${maCells}
                ${noteCell}
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
    // 有放纵记录时, 追加放纵日图例(竖虚线 + emoji)
    if (lastIndulgences.length > 0) {
        items.push(
            `<span class="legend-item"><i class="dash-mark"></i>放纵日 🍺🍰</span>`
        );
    }
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

    // 各曲线序列(体重 + 各窗口均值), 用于静态数据点、高亮点与提示内容
    const series = [
        { key: "weight", color: WEIGHT_COLOR },
        ...currentWindows.map((w, i) => ({ key: `ma_${w}`, color: maColor(i) })),
    ];

    // 静态数据点: 所有序列都画小圆点, 仅在该点有值时绘制
    const dots = series
        .map((s) =>
            records
                .map((r, i) =>
                    r[s.key] != null
                        ? `<circle cx="${x(i)}" cy="${y(r[s.key])}" r="3" fill="${s.color}" />`
                        : ""
                )
                .join("")
        )
        .join("");

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

    // 放纵日标记: 在有体重记录的放纵日画竖向参考线(背景层)与顶部 emoji(前景层),
    // 便于直观对齐 "喝酒/吃好吃的之后, 体重曲线是否抬头"。
    const indulgeLines = records
        .map((r, i) =>
            indulgencesForDate(r.date).length > 0
                ? `<line x1="${x(i)}" x2="${x(i)}" y1="${pad.top}" y2="${pad.top + innerH}"` +
                  ` stroke="#f59e0b" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" />`
                : ""
        )
        .join("");
    const indulgeMarks = records
        .map((r, i) => {
            const items = indulgencesForDate(r.date);
            if (items.length === 0) return "";
            const kinds = new Set();
            items.forEach((it) => (it.kinds || []).forEach((k) => kinds.add(k)));
            let emoji = "";
            if (kinds.has("alcohol")) emoji += "🍺";
            if (kinds.has("food")) emoji += "🍰";
            return `<text x="${x(i)}" y="${pad.top - 6}" text-anchor="middle" font-size="12">${emoji}</text>`;
        })
        .join("");

    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
            ${grid}
            ${indulgeLines}
            ${guide}
            ${maLines}
            ${line("weight", WEIGHT_COLOR)}
            ${dots}
            ${indulgeMarks}
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
    // 当天若有放纵记录, 追加放纵详情行(触发原因 + 类型)
    indulgencesForDate(r.date).forEach((it) => {
        const kinds = (it.kinds || []).map((k) => KIND_LABELS[k] || k).join("、");
        const trigger = TRIGGER_LABELS[it.trigger] || it.trigger;
        rows.push(`<div class="tip-row tip-indulge">⚠️ 放纵 · ${trigger} · ${kinds}</div>`);
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

/** 帮助浮层交互: 点击 "?" 切换显示(兼容触屏), 点击别处则收起。 */
function attachHelpToggle() {
    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".help-btn");
        if (btn) {
            // 点击 "?": 切换当前浮层, 同时收起其它已展开的浮层
            const help = btn.parentElement;
            const opened = help.classList.contains("open");
            document.querySelectorAll(".help.open").forEach((el) => el.classList.remove("open"));
            if (!opened) help.classList.add("open");
            return;
        }
        // 点击浮层以外区域: 收起全部
        if (!e.target.closest(".help-pop")) {
            document.querySelectorAll(".help.open").forEach((el) => el.classList.remove("open"));
        }
    });
}

/**
 * 备注浮层交互。

 * 由于表格容器存在 overflow 裁剪, 浮层挂在 body 上并用 fixed 定位,
 * 避免被表头或滚动容器遮挡; 悬浮即显示, 几乎无延迟。体重历史表与放纵
 * 列表共用同一个浮层, 故传入多个表体 id 统一绑定。

 * Args:
 *     bodyIds: 需要绑定备注浮层的 tbody 元素 id 列表。
 */
function attachNoteTooltip(bodyIds) {
    const bodies = bodyIds
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (bodies.length === 0) return;

    const tip = document.createElement("div");
    tip.id = "note-tooltip";
    tip.hidden = true;
    document.body.appendChild(tip);

    const positionTip = (cell) => {
        const rect = cell.getBoundingClientRect();
        tip.style.maxWidth = "260px";
        // 先显示以便测量尺寸
        tip.hidden = false;
        const tipRect = tip.getBoundingClientRect();
        const margin = 8;
        let left = rect.left;
        // 右侧越界时向左收回
        if (left + tipRect.width > window.innerWidth - margin) {
            left = window.innerWidth - margin - tipRect.width;
        }
        if (left < margin) left = margin;
        // 默认显示在单元格上方, 上方空间不足则放到下方
        let top = rect.top - tipRect.height - margin;
        if (top < margin) top = rect.bottom + margin;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    };

    bodies.forEach((body) => {
        body.addEventListener("mouseover", (e) => {
            const cell = e.target.closest(".note-cell");
            if (!cell || !body.contains(cell)) return;
            const note = cell.dataset.note;
            if (!note) return;
            // 仅当备注被截断(超过 2 行出现省略号)时才显示浮层
            const text = cell.querySelector(".note-text");
            if (!text || text.scrollHeight <= text.clientHeight + 1) return;
            tip.textContent = note;
            positionTip(cell);
        });

        body.addEventListener("mouseout", (e) => {
            const cell = e.target.closest(".note-cell");
            if (!cell) return;
            // 移动到单元格内部子元素时不隐藏
            if (cell.contains(e.relatedTarget)) return;
            tip.hidden = true;
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("date").value = todayStr();
    document.getElementById("record-form").addEventListener("submit", submitRecord);
    // 切换日期时, 实时反映该日期是否已有记录(按钮文案与覆盖提示)
    document.getElementById("date").addEventListener("change", updateFormState);
    // 全页统一: 点 label 文字不再聚焦关联输入框(含放纵表单), 避免误触困惑
    disableLabelClickFocus();
    // 接入自定义日历选择器(组件定义见 datepicker.js)
    attachDatePicker(document.getElementById("date"));
    attachHelpToggle();
    // 体重历史表与放纵列表共用备注浮层
    attachNoteTooltip(["record-body", "indulgence-body"]);
    document.getElementById("page-prev").addEventListener("click", () => {
        if (currentPage > 1) goToPage(currentPage - 1);
    });
    document.getElementById("page-next").addEventListener("click", () => {
        goToPage(currentPage + 1);
    });

    // 个人档案(身高)交互: 默认只读, 点编辑才可改
    document.getElementById("profile-edit-btn").addEventListener("click", startProfileEdit);
    document.getElementById("profile-cancel-btn").addEventListener("click", cancelProfileEdit);
    document.getElementById("profile-edit").addEventListener("submit", submitProfile);

    // 目标体重交互: 默认只读, 点编辑才可改; 起点日期接入自定义日历
    document.getElementById("target-edit-btn").addEventListener("click", startTargetEdit);
    document.getElementById("target-cancel-btn").addEventListener("click", cancelTargetEdit);
    document.getElementById("target-edit").addEventListener("submit", submitTarget);
    attachDatePicker(document.getElementById("target-start"));

    // 放纵记录的初始化与交互见 indulgence.js
    loadProfile();
    loadRecords();
});
