"use strict";

// 放纵记录模块: 录入(一天一条, 同日覆盖)、坚持天数横幅、列表、内联编辑与删除。
// 共享工具(escapeHtml / escapeAttr / todayStr / ICON_* / attachNoteTooltip)由
// app.js 定义并先行加载, 此处直接复用; 趋势图(app.js)则反向读取本模块导出的
// lastIndulgences / indulgencesForDate / KIND_LABELS / TRIGGER_LABELS 来标记放纵日。

const INDULGENCE_API = "/api/indulgences";

// 放纵记录的枚举值到中文展示文案的映射(趋势图浮层与列表共用)
const KIND_LABELS = { alcohol: "🍺 喝酒", food: "🍰 吃好吃的" };
const TRIGGER_LABELS = { stress: "😣 压力大", reward: "🎉 奖励自己" };

// 缓存最近一次拉取的放纵记录, 供趋势图标记放纵日与表单覆盖提示复用
let lastIndulgences = [];
// 正在内联编辑的放纵记录 id; null 表示无编辑中行
let editingIndulgenceId = null;

/** 返回某天的全部放纵记录(一天一条, 故至多一条; 供趋势图标记与浮层)。 */
function indulgencesForDate(date) {
    return lastIndulgences.filter((r) => r.date === date);
}

/** 按日期在缓存的放纵记录中查找对应记录。 */
function findIndulgenceByDate(date) {
    return lastIndulgences.find((r) => r.date === date) || null;
}

/**
 * 计算两个 yyyy-mm-dd 日期相差的天数(按本地自然日)。
 *
 * Args:
 *     fromDate: 起始日期字符串。
 *     toDate: 结束日期字符串。
 *
 * Returns:
 *     number: toDate 减 fromDate 的天数差。
 */
function dayDiff(fromDate, toDate) {
    const a = new Date(`${fromDate}T00:00:00`);
    const b = new Date(`${toDate}T00:00:00`);
    return Math.round((b - a) / 86400000);
}

/** 显示放纵记录区的提示信息。 */
function showIndulgenceMsg(text, ok) {
    const el = document.getElementById("indulgence-msg");
    el.textContent = text;
    el.className = "form-msg " + (ok ? "ok" : "err");
}

/**
 * 根据所选日期是否已有放纵记录, 更新提交按钮文案与覆盖提示。
 *
 * 放纵约定一天一条; 选到已有记录的日期时, 按钮显示"更新记录"并提示再次提交
 * 将覆盖, 与体重录入保持一致的交互, 避免误覆盖既有记录。
 */
function updateIndulgenceFormState() {
    const dateInput = document.getElementById("ind-date");
    const submitBtn = document.getElementById("ind-submit-btn");
    const hint = document.getElementById("ind-date-hint");
    if (!dateInput || !submitBtn || !hint) return;

    const existing = dateInput.value ? findIndulgenceByDate(dateInput.value) : null;
    if (existing) {
        submitBtn.textContent = "更新记录";
        const kinds = (existing.kinds || []).map((k) => KIND_LABELS[k] || k).join("、");
        const trigger = TRIGGER_LABELS[existing.trigger] || existing.trigger;
        const prefix = dateInput.value === todayStr() ? "今日已记录放纵" : "该日期已记录放纵";
        hint.textContent = `${prefix}：${trigger} · ${kinds}，再次提交将覆盖。`;
        hint.hidden = false;
    } else {
        submitBtn.textContent = "记一笔";
        hint.hidden = true;
    }
}

/** 拉取放纵记录并刷新坚持天数横幅、列表、表单提示与趋势图标记。 */
async function loadIndulgences() {
    const res = await fetch(INDULGENCE_API);
    const json = await res.json();
    lastIndulgences = json.data ? json.data.records : [];
    renderStreak(lastIndulgences);
    renderIndulgenceList(lastIndulgences);
    updateIndulgenceFormState();
    // 放纵记录变化后, 若已有体重数据则重绘趋势图以更新放纵日标记
    if (typeof lastRecords !== "undefined" && lastRecords.length > 0) {
        renderChart(lastRecords);
    }
}

/**
 * 渲染"已坚持 N 天没放纵"横幅。
 *
 * N 取今天与最近一次放纵日期的天数差; 当天即放纵则归零并标红提醒。
 *
 * Args:
 *     records: 放纵记录列表(已按日期倒序)。
 */
function renderStreak(records) {
    const banner = document.getElementById("streak-banner");
    const daysEl = document.getElementById("streak-days");
    const subEl = document.getElementById("streak-sub");

    if (!records || records.length === 0) {
        banner.classList.remove("broken-today");
        daysEl.textContent = "--";
        subEl.textContent = "暂无放纵记录，保持住~";
        return;
    }

    // 列表已按日期倒序, 第一条即最近一次放纵
    const latest = records[0];
    const days = Math.max(0, dayDiff(latest.date, todayStr()));
    daysEl.textContent = days;
    banner.classList.toggle("broken-today", days === 0);

    const kinds = (latest.kinds || []).map((k) => KIND_LABELS[k] || k).join("、");
    const trigger = TRIGGER_LABELS[latest.trigger] || latest.trigger;
    subEl.textContent =
        days === 0
            ? `今天放纵了：${trigger} · ${kinds}，明天重新开始 💪`
            : `上次：${latest.date} · ${trigger} · ${kinds}`;
}

/**
 * 构造分段选择控件(seg-group)的 HTML, 用于内联编辑行。
 *
 * Args:
 *     multi: 是否多选(类型为多选, 触发原因为单选)。
 *     options: 选项数组, 元素含 val 与 label。
 *     selected: 已选值集合(数组), 命中的按钮加 active 类。
 *
 * Returns:
 *     string: seg-group 的 HTML 字符串, data-value 预填当前选中值。
 */
function segGroupHtml(multi, options, selected) {
    const btns = options
        .map((opt) => {
            const active = selected.includes(opt.val) ? " active" : "";
            return `<button type="button" class="seg-btn${active}" data-val="${opt.val}">${opt.label}</button>`;
        })
        .join("");
    return (
        `<div class="seg-group seg-sm"${multi ? ' data-multi="true"' : ""}` +
        ` data-value="${selected.join(",")}">${btns}</div>`
    );
}

/** 渲染放纵记录列表(最新在前, 支持内联编辑与删除)。 */
function renderIndulgenceList(records) {
    const body = document.getElementById("indulgence-body");
    const emptyTip = document.getElementById("ind-empty-tip");
    body.innerHTML = "";

    if (!records || records.length === 0) {
        emptyTip.hidden = false;
        return;
    }
    emptyTip.hidden = true;

    const kindOptions = [
        { val: "alcohol", label: KIND_LABELS.alcohol },
        { val: "food", label: KIND_LABELS.food },
    ];
    const triggerOptions = [
        { val: "stress", label: TRIGGER_LABELS.stress },
        { val: "reward", label: TRIGGER_LABELS.reward },
    ];

    records.forEach((r) => {
        const tr = document.createElement("tr");
        if (r.id === editingIndulgenceId) {
            tr.className = "editing";
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${segGroupHtml(true, kindOptions, r.kinds || [])}</td>
                <td>${segGroupHtml(false, triggerOptions, [r.trigger])}</td>
                <td><input class="edit-input ind-edit-note" type="text" maxlength="500" value="${escapeAttr(r.note)}" placeholder="备注" /></td>
                <td>
                    <div class="action-cell">
                        <button class="icon-btn btn-save" data-id="${r.id}" title="保存">${ICON_SAVE}</button>
                        <button class="icon-btn btn-cancel" title="取消">${ICON_CANCEL}</button>
                    </div>
                </td>
            `;
        } else {
            const kindTags = (r.kinds || [])
                .map((k) => `<span class="ind-tag kind-${k}">${KIND_LABELS[k] || k}</span>`)
                .join(" ");
            const trigger = TRIGGER_LABELS[r.trigger] || r.trigger;
            const noteCell = r.note
                ? `<td class="note-cell" data-note="${escapeAttr(r.note)}"><span class="note-text">${escapeHtml(r.note)}</span></td>`
                : `<td class="note-cell"></td>`;
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${kindTags}</td>
                <td><span class="ind-tag trigger-${r.trigger}">${trigger}</span></td>
                ${noteCell}
                <td>
                    <div class="action-cell">
                        <button class="icon-btn btn-edit" data-id="${r.id}" title="编辑">${ICON_EDIT}</button>
                        <button class="icon-btn btn-del" data-id="${r.id}" title="删除">${ICON_DELETE}</button>
                    </div>
                </td>
            `;
        }
        body.appendChild(tr);
    });

    bindIndulgenceRowActions(body);
}

/** 绑定放纵列表行内的编辑/删除/保存/取消事件, 并为编辑行的分段控件挂交互。 */
function bindIndulgenceRowActions(body) {
    body.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.addEventListener("click", () => startIndulgenceEdit(Number(btn.dataset.id)));
    });
    body.querySelectorAll(".btn-del").forEach((btn) => {
        btn.addEventListener("click", () => deleteIndulgence(btn.dataset.id));
    });
    body.querySelectorAll(".btn-save").forEach((btn) => {
        btn.addEventListener("click", () => saveIndulgenceEdit(Number(btn.dataset.id)));
    });
    body.querySelectorAll(".btn-cancel").forEach((btn) => {
        btn.addEventListener("click", () => cancelIndulgenceEdit());
    });
    body.querySelectorAll("tr.editing .seg-group").forEach((group) => bindSegGroup(group));
    body.querySelectorAll("tr.editing .ind-edit-note").forEach((input) => {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveIndulgenceEdit(editingIndulgenceId);
            else if (e.key === "Escape") cancelIndulgenceEdit();
        });
    });
}

/** 进入某条放纵记录的内联编辑状态。 */
function startIndulgenceEdit(id) {
    editingIndulgenceId = id;
    renderIndulgenceList(lastIndulgences);
}

/** 取消编辑, 恢复只读展示。 */
function cancelIndulgenceEdit() {
    editingIndulgenceId = null;
    renderIndulgenceList(lastIndulgences);
}

/** 保存内联编辑(PUT 更新类型 / 触发原因 / 备注)。 */
async function saveIndulgenceEdit(id) {
    const row = document.querySelector("tr.editing");
    if (!row) return;
    const kinds = row
        .querySelector('.seg-group[data-multi="true"]')
        .dataset.value.split(",")
        .filter(Boolean);
    const trigger = row.querySelector(".seg-group:not([data-multi])").dataset.value;
    const note = row.querySelector(".ind-edit-note").value;

    if (kinds.length === 0) {
        alert("请至少选择一个类型");
        return;
    }

    const res = await fetch(`${INDULGENCE_API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kinds, trigger, note }),
    });
    const json = await res.json();
    if (json.code === 200) {
        editingIndulgenceId = null;
        await loadIndulgences();
    } else {
        alert(json.message || "保存失败");
    }
}

/** 提交一条放纵记录(一天一条, 同日覆盖)。 */
async function submitIndulgence(e) {
    e.preventDefault();
    const date = document.getElementById("ind-date").value;
    const kinds = document
        .getElementById("ind-kind")
        .dataset.value.split(",")
        .filter(Boolean);
    const trigger = document.getElementById("ind-trigger").dataset.value;
    const note = document.getElementById("ind-note").value;

    if (!date) {
        showIndulgenceMsg("请选择日期", false);
        return;
    }
    if (kinds.length === 0) {
        showIndulgenceMsg("请至少选择一个类型", false);
        return;
    }

    const res = await fetch(INDULGENCE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, kinds, trigger, note }),
    });
    const json = await res.json();
    if (json.code === 200) {
        showIndulgenceMsg("已记录 ✓", true);
        document.getElementById("ind-note").value = "";
        editingIndulgenceId = null;
        await loadIndulgences();
    } else {
        showIndulgenceMsg(json.message || "保存失败", false);
    }
}

/** 删除指定 id 的放纵记录。 */
async function deleteIndulgence(id) {
    if (!confirm("确认删除这条放纵记录?")) return;
    const res = await fetch(`${INDULGENCE_API}/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code === 200) {
        if (editingIndulgenceId === Number(id)) editingIndulgenceId = null;
        await loadIndulgences();
    } else {
        alert(json.message || "删除失败");
    }
}

/** 绑定单个分段选择控件: 点击切换选中态, 选中值存于容器的 data-value。 */
function bindSegGroup(group) {
    const multi = group.dataset.multi === "true";
    group.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (multi) {
                btn.classList.toggle("active");
                // 至少保留一个选中, 防止取消到空
                if (group.querySelectorAll(".seg-btn.active").length === 0) {
                    btn.classList.add("active");
                }
                const vals = [...group.querySelectorAll(".seg-btn.active")].map(
                    (b) => b.dataset.val
                );
                group.dataset.value = vals.join(",");
            } else {
                group.dataset.value = btn.dataset.val;
                group
                    .querySelectorAll(".seg-btn")
                    .forEach((b) => b.classList.toggle("active", b === btn));
            }
        });
    });
}

/** 绑定页面上所有静态分段选择控件(主录入表单)。 */
function attachSegGroups() {
    document.querySelectorAll(".seg-group").forEach((group) => bindSegGroup(group));
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("ind-date").value = todayStr();
    attachSegGroups();
    document.getElementById("indulgence-form").addEventListener("submit", submitIndulgence);
    // 切换日期时, 实时反映该日期是否已有放纵记录(按钮文案与覆盖提示)
    document.getElementById("ind-date").addEventListener("change", updateIndulgenceFormState);
    loadIndulgences();
});
