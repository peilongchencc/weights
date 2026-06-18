"use strict";

// 自定义日历选择器: 替换原生 <input type="date"> 弹窗, 统一风格与交互体验。
//
// 设计要点:
//   - 输入框保持只读文本, 值仍为 yyyy-mm-dd, 选中后派发 change 事件, 完全兼容
//     既有的 updateFormState / updateIndulgenceFormState 等逻辑;
//   - 全页共用一个浮层单例, 通过 attachDatePicker(input) 把任意输入框接入;
//   - 浮层 fixed 定位于输入框下方, 空间不足时自动上翻, 滚动/缩放时跟随重定位;
//   - 三级视图(日/月/年): 点击标题逐级放大, 可快速跳转到目标年月;
//   - 禁止选择未来日期: 未来的日/月/年单元格与对应翻页按钮均不可点击。

(function () {
    // 周首列到列尾依次为周日至周六, 与中国习惯的"日一二三四五六"一致
    const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
    // 一个月最多跨 6 周, 固定渲染 42 格以保持高度稳定
    const TOTAL_CELLS = 42;
    // 年份视图每页展示的年数(3 列 x 4 行)
    const YEARS_PER_PAGE = 12;

    let popup = null; // 浮层单例
    let activeInput = null; // 当前关联的输入框
    let viewMode = "days"; // 当前视图: days / months / years
    let viewYear = 0; // 当前展示的年份
    let viewMonth = 0; // 当前展示的月份(0-11)
    let yearPageStart = 0; // 年份视图当前页的起始年份

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

    /** 判断某一天是否晚于今天(未来)。 */
    function isFutureDay(y, m, d) {
        const t = todayParts();
        if (y !== t.y) return y > t.y;
        if (m !== t.m) return m > t.m;
        return d > t.d;
    }

    /** 判断某个月份(整月)是否在今天所在月份之后。 */
    function isFutureMonth(y, m) {
        const t = todayParts();
        return y > t.y || (y === t.y && m > t.m);
    }

    /** 判断某个年份是否在今年之后。 */
    function isFutureYear(y) {
        return y > todayParts().y;
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

    /** 浮层内的点击事件委托: 视图切换、翻页、选日、今天、清除。 */
    function onPopupClick(e) {
        const target = e.target.closest("[data-action]");
        if (!target || target.disabled) return;
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
        } else if (action === "to-months") {
            viewMode = "months";
            render();
        } else if (action === "to-years") {
            yearPageStart = viewYear - (((viewYear % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
            viewMode = "years";
            render();
        } else if (action === "prev-years") {
            yearPageStart -= YEARS_PER_PAGE;
            render();
        } else if (action === "next-years") {
            yearPageStart += YEARS_PER_PAGE;
            render();
        } else if (action === "pick-month") {
            viewMonth = Number(target.dataset.month);
            viewMode = "days";
            render();
        } else if (action === "pick-year") {
            viewYear = Number(target.dataset.year);
            viewMode = "months";
            render();
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

    /** 选中具体日期: 写回输入框并关闭浮层(未来日期忽略)。 */
    function commit(y, m, d) {
        if (isFutureDay(y, m, d)) return;
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

    /**
     * 生成头部翻页按钮的 HTML。
     *
     * Args:
     *     action: data-action 标识。
     *     label: 无障碍标签文本。
     *     glyph: 按钮内显示的字符(HTML 实体)。
     *     disabled: 是否禁用(未来方向时为 true)。
     */
    function navBtn(action, label, glyph, disabled) {
        const cls = "dp-nav" + (disabled ? " disabled" : "");
        const attr = disabled ? " disabled" : "";
        return (
            `<button type="button" class="${cls}" data-action="${action}" ` +
            `aria-label="${label}"${attr}>${glyph}</button>`
        );
    }

    /** 渲染日视图(具体日期网格)。 */
    function renderDays() {
        const selected = parseDate(activeInput && activeInput.value);
        const today = todayParts();

        // 当月第一天是周几(0=周日), 以及上月需要补齐的天数
        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = 0; i < TOTAL_CELLS; i++) {
            const offset = i - firstWeekday;
            let m = viewMonth;
            let d;
            let muted = false;
            if (offset < 0) {
                muted = true;
                m = viewMonth - 1;
                d = daysInPrev + offset + 1;
            } else if (offset >= daysInMonth) {
                muted = true;
                m = viewMonth + 1;
                d = offset - daysInMonth + 1;
            } else {
                d = offset + 1;
            }
            // 归一化跨年的月份, 保证写回的日期字符串正确
            const norm = new Date(viewYear, m, d);
            const ny = norm.getFullYear();
            const nm = norm.getMonth();
            const nd = norm.getDate();

            const isToday = ny === today.y && nm === today.m && nd === today.d;
            const isSelected =
                selected && ny === selected.y && nm === selected.m && nd === selected.d;
            const future = isFutureDay(ny, nm, nd);

            const classes = ["dp-cell"];
            if (muted) classes.push("muted");
            if (isToday) classes.push("today");
            if (isSelected) classes.push("selected");
            if (future) classes.push("disabled");

            cells.push(
                `<button type="button" class="${classes.join(" ")}" ` +
                    `data-action="day" data-date="${fmtDate(ny, nm, nd)}"` +
                    `${future ? " disabled" : ""}>${nd}</button>`
            );
        }

        const weekHtml = WEEKDAYS.map(
            (w) => `<span class="dp-weekday">${w}</span>`
        ).join("");

        popup.innerHTML =
            `<div class="dp-header">` +
            navBtn("prev-year", "上一年", "&#171;", false) +
            navBtn("prev-month", "上个月", "&#8249;", false) +
            `<button type="button" class="dp-title" data-action="to-months">` +
            `${viewYear} 年 ${viewMonth + 1} 月</button>` +
            navBtn("next-month", "下个月", "&#8250;", isFutureMonth(viewYear, viewMonth + 1)) +
            navBtn("next-year", "下一年", "&#187;", isFutureYear(viewYear + 1)) +
            `</div>` +
            `<div class="dp-weekdays">${weekHtml}</div>` +
            `<div class="dp-grid">${cells.join("")}</div>` +
            `<div class="dp-footer">` +
            `<button type="button" class="dp-foot-btn" data-action="clear">清除</button>` +
            `<button type="button" class="dp-foot-btn dp-foot-today" data-action="today">今天</button>` +
            `</div>`;
    }

    /** 渲染月视图(选择某一年的月份)。 */
    function renderMonths() {
        const today = todayParts();
        const cells = [];
        for (let m = 0; m < 12; m++) {
            const isSelected = m === viewMonth;
            const isCur = viewYear === today.y && m === today.m;
            const future = isFutureMonth(viewYear, m);

            const classes = ["dp-mcell"];
            if (isCur) classes.push("today");
            if (isSelected) classes.push("selected");
            if (future) classes.push("disabled");

            cells.push(
                `<button type="button" class="${classes.join(" ")}" ` +
                    `data-action="pick-month" data-month="${m}"` +
                    `${future ? " disabled" : ""}>${m + 1} 月</button>`
            );
        }

        popup.innerHTML =
            `<div class="dp-header">` +
            navBtn("prev-year", "上一年", "&#171;", false) +
            `<button type="button" class="dp-title" data-action="to-years">${viewYear} 年</button>` +
            navBtn("next-year", "下一年", "&#187;", isFutureYear(viewYear + 1)) +
            `</div>` +
            `<div class="dp-grid dp-mygrid">${cells.join("")}</div>`;
    }

    /** 渲染年视图(整页年份, 点击进入对应年的月视图)。 */
    function renderYears() {
        const today = todayParts();
        const start = yearPageStart;
        const end = start + YEARS_PER_PAGE - 1;
        const cells = [];
        for (let y = start; y <= end; y++) {
            const isSelected = y === viewYear;
            const isCur = y === today.y;
            const future = isFutureYear(y);

            const classes = ["dp-mcell"];
            if (isCur) classes.push("today");
            if (isSelected) classes.push("selected");
            if (future) classes.push("disabled");

            cells.push(
                `<button type="button" class="${classes.join(" ")}" ` +
                    `data-action="pick-year" data-year="${y}"` +
                    `${future ? " disabled" : ""}>${y}</button>`
            );
        }

        popup.innerHTML =
            `<div class="dp-header">` +
            navBtn("prev-years", "上一组", "&#171;", false) +
            `<span class="dp-title">${start} - ${end}</span>` +
            navBtn("next-years", "下一组", "&#187;", start + YEARS_PER_PAGE > today.y) +
            `</div>` +
            `<div class="dp-grid dp-mygrid">${cells.join("")}</div>`;
    }

    /** 依据 viewMode 选择对应的视图渲染。 */
    function render() {
        ensurePopup();
        if (viewMode === "months") {
            renderMonths();
        } else if (viewMode === "years") {
            renderYears();
        } else {
            renderDays();
        }
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
        viewMode = "days";
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
