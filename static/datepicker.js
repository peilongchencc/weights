"use strict";

// 自定义日历选择器: 替换原生 <input type="date"> 弹窗, 统一风格与交互体验。
//
// 设计要点:
//   - 输入框保持只读文本, 值仍为 yyyy-mm-dd, 选中后派发 change 事件, 完全兼容
//     既有的 updateFormState / updateIndulgenceFormState 等逻辑;
//   - 全页共用一个浮层单例, 通过 attachDatePicker(input) 把任意输入框接入;
//   - 浮层 fixed 定位于输入框下方, 空间不足时自动上翻, 滚动/缩放时跟随重定位。

(function () {
    // 周首列到列尾依次为周日至周六, 与中国习惯的"日一二三四五六"一致
    const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
    // 一个月最多跨 6 周, 固定渲染 42 格以保持高度稳定
    const TOTAL_CELLS = 42;

    let popup = null; // 浮层单例
    let activeInput = null; // 当前关联的输入框
    let viewYear = 0; // 当前展示的年份
    let viewMonth = 0; // 当前展示的月份(0-11)

    /**
     * 解析 yyyy-mm-dd 字符串为日期分量。
     *
     * Args:
     *     str: 形如 "2026-06-18" 的字符串。
     *
     * Returns:
     *     object|null: 含 y / m(0-11) / d 的对象; 非法输入返回 null。
     */
    function parseDate(str) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
        if (!match) return null;
        const y = Number(match[1]);
        const m = Number(match[2]) - 1;
        const d = Number(match[3]);
        return { y, m, d };
    }

    /** 把日期分量格式化为 yyyy-mm-dd。 */
    function fmtDate(y, m, d) {
        const mm = String(m + 1).padStart(2, "0");
        const dd = String(d).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
    }

    /** 返回本地今天的日期分量 {y, m, d}。 */
    function todayParts() {
        const t = new Date();
        return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
    }

    /** 创建并缓存浮层单例(含一次性的事件委托)。 */
    function ensurePopup() {
        if (popup) return popup;
        popup = document.createElement("div");
        popup.className = "dp-popup";
        popup.hidden = true;
        // 在浮层上按下鼠标时阻止默认行为, 避免输入框失焦导致浮层提前关闭
        popup.addEventListener("mousedown", (e) => e.preventDefault());
        popup.addEventListener("click", onPopupClick);
        document.body.appendChild(popup);
        return popup;
    }

    /** 浮层内的点击事件委托: 翻页、选日、今天、清除。 */
    function onPopupClick(e) {
        const target = e.target.closest("[data-action]");
        if (!target) return;
        const action = target.dataset.action;

        if (action === "prev-year") {
            viewYear -= 1;
            render();
        } else if (action === "next-year") {
            viewYear += 1;
            render();
        } else if (action === "prev-month") {
            shiftMonth(-1);
        } else if (action === "next-month") {
            shiftMonth(1);
        } else if (action === "today") {
            const t = todayParts();
            commit(t.y, t.m, t.d);
        } else if (action === "clear") {
            commitValue("");
        } else if (action === "day") {
            const parts = parseDate(target.dataset.date);
            if (parts) commit(parts.y, parts.m, parts.d);
        }
    }

    /** 在当前视图基础上前后切换月份(自动跨年)。 */
    function shiftMonth(delta) {
        viewMonth += delta;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear -= 1;
        } else if (viewMonth > 11) {
            viewMonth = 0;
            viewYear += 1;
        }
        render();
    }

    /** 选中具体日期: 写回输入框并关闭浮层。 */
    function commit(y, m, d) {
        commitValue(fmtDate(y, m, d));
    }

    /**
     * 写回输入框的值并触发 change, 随后关闭浮层。
     *
     * Args:
     *     value: yyyy-mm-dd 字符串; 空串表示清除。
     */
    function commitValue(value) {
        if (!activeInput) return;
        activeInput.value = value;
        activeInput.dispatchEvent(new Event("change", { bubbles: true }));
        close();
    }

    /** 依据 viewYear / viewMonth 重新渲染浮层内容。 */
    function render() {
        ensurePopup();
        const selected = parseDate(activeInput && activeInput.value);
        const today = todayParts();

        // 当月第一天是周几(0=周日), 以及上月需要补齐的天数
        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = 0; i < TOTAL_CELLS; i++) {
            const offset = i - firstWeekday;
            let y = viewYear;
            let m = viewMonth;
            let d;
            let muted = false;
            if (offset < 0) {
                // 上个月的尾部几天
                muted = true;
                m = viewMonth - 1;
                d = daysInPrev + offset + 1;
            } else if (offset >= daysInMonth) {
                // 下个月的开头几天
                muted = true;
                m = viewMonth + 1;
                d = offset - daysInMonth + 1;
            } else {
                d = offset + 1;
            }
            // 归一化跨年的月份, 保证写回的日期字符串正确
            const norm = new Date(y, m, d);
            const ny = norm.getFullYear();
            const nm = norm.getMonth();
            const nd = norm.getDate();

            const isToday = ny === today.y && nm === today.m && nd === today.d;
            const isSelected =
                selected && ny === selected.y && nm === selected.m && nd === selected.d;

            const classes = ["dp-cell"];
            if (muted) classes.push("muted");
            if (isToday) classes.push("today");
            if (isSelected) classes.push("selected");

            cells.push(
                `<button type="button" class="${classes.join(" ")}" ` +
                    `data-action="day" data-date="${fmtDate(ny, nm, nd)}">${nd}</button>`
            );
        }

        const weekHtml = WEEKDAYS.map(
            (w) => `<span class="dp-weekday">${w}</span>`
        ).join("");

        popup.innerHTML =
            `<div class="dp-header">` +
            `<button type="button" class="dp-nav" data-action="prev-year" aria-label="上一年">&#171;</button>` +
            `<button type="button" class="dp-nav" data-action="prev-month" aria-label="上个月">&#8249;</button>` +
            `<span class="dp-title">${viewYear} 年 ${viewMonth + 1} 月</span>` +
            `<button type="button" class="dp-nav" data-action="next-month" aria-label="下个月">&#8250;</button>` +
            `<button type="button" class="dp-nav" data-action="next-year" aria-label="下一年">&#187;</button>` +
            `</div>` +
            `<div class="dp-weekdays">${weekHtml}</div>` +
            `<div class="dp-grid">${cells.join("")}</div>` +
            `<div class="dp-footer">` +
            `<button type="button" class="dp-foot-btn" data-action="clear">清除</button>` +
            `<button type="button" class="dp-foot-btn dp-foot-today" data-action="today">今天</button>` +
            `</div>`;
    }

    /** 把浮层定位到输入框下方, 空间不足时上翻并做左右夹取。 */
    function position() {
        if (!popup || !activeInput) return;
        const rect = activeInput.getBoundingClientRect();
        const gap = 6;
        const pw = popup.offsetWidth;
        const ph = popup.offsetHeight;

        let left = rect.left;
        if (left + pw > window.innerWidth - 8) {
            left = window.innerWidth - 8 - pw;
        }
        if (left < 8) left = 8;

        // 默认在输入框下方; 下方空间不足且上方更宽裕时翻到上方
        let top = rect.bottom + gap;
        if (top + ph > window.innerHeight - 8 && rect.top - gap - ph > 8) {
            top = rect.top - gap - ph;
        }

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
    }

    /** 打开浮层并定位到目标输入框。 */
    function open(input) {
        activeInput = input;
        const parts = parseDate(input.value) || todayParts();
        viewYear = parts.y;
        viewMonth = parts.m;
        ensurePopup();
        render();
        popup.hidden = false;
        popup.classList.add("open");
        position();
    }

    /** 关闭浮层。 */
    function close() {
        if (!popup) return;
        popup.hidden = true;
        popup.classList.remove("open");
        activeInput = null;
    }

    /**
     * 把自定义日历挂到一个输入框上。
     *
     * Args:
     *     input: 只读文本输入框; 为空时直接返回。
     */
    function attachDatePicker(input) {
        if (!input) return;
        input.addEventListener("click", () => {
            if (popup && !popup.hidden && activeInput === input) {
                close();
            } else {
                open(input);
            }
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });
    }

    // 点击浮层与输入框以外区域时关闭
    document.addEventListener("mousedown", (e) => {
        if (!popup || popup.hidden) return;
        if (e.target === activeInput) return;
        if (popup.contains(e.target)) return;
        close();
    });
    // 滚动或缩放时跟随重新定位, 保证浮层始终贴着输入框
    window.addEventListener("resize", () => {
        if (popup && !popup.hidden) position();
    });
    window.addEventListener(
        "scroll",
        () => {
            if (popup && !popup.hidden) position();
        },
        true
    );

    // 暴露给 app.js / indulgence.js 调用
    window.attachDatePicker = attachDatePicker;
})();
