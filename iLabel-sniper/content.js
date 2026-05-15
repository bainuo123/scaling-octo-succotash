console.log('[Content] ✅ Content Script 已注入!');

if (window.__ILABEL_SNIPER_RUNNING__) {
    console.warn('[Content] ⚠️ 已有实例在运行，跳过重复注入');
} else {
    window.__ILABEL_SNIPER_RUNNING__ = true;

(function () {

    let polling = false;
    let hidden = false;
    let lastTaskId = null;

    let successCount = 0;
    let requestCount = 0;
    let failureCount = 0;

    let waitingRefreshAfterHit = false;
    let answeringTask = false;
    let manuallyStarted = false;

    let lastRefreshClickAt = 0;

    const POLL_INTERVAL = 180;
    const REFRESH_CLICK_INTERVAL = 2500;

    const RATE_LIMIT_COOLDOWN = 1200;
    const MAX_BACKOFF = 3000;

    let dynamicDelay = POLL_INTERVAL;

    function extractMissionIdFromUrl() {
        const match = window.location.href.match(/mission\/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    const currentMissionId = extractMissionIdFromUrl();
    if (!currentMissionId) return;

    function getPageKey() {
        return `page_${currentMissionId}`;
    }

    function createPanel() {
        setTimeout(() => {
            if (document.getElementById('mini-sniper-panel')) return;

            const panel = document.createElement('div');
            panel.id = 'mini-sniper-panel';
            panel.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                width: 260px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.15);
                padding: 16px;
                z-index: 999999;
                font-size: 12px;
            `;

            panel.innerHTML = `
                <div><strong>iLabel Sniper</strong></div>
                <div>状态: <span id="status-text">初始化</span></div>
                <div>请求: <span id="request-count">0</span></div>
                <div>成功: <span id="success-count">0</span></div>
                <div>失败: <span id="failure-count">0</span></div>
            `;

            document.body.appendChild(panel);
        }, 100);
    }

    function updatePanel(status) {
        const panel = document.getElementById('mini-sniper-panel');
        if (!panel) return;

        panel.querySelector('#status-text').textContent = status;
        panel.querySelector('#request-count').textContent = requestCount;
        panel.querySelector('#success-count').textContent = successCount;
        panel.querySelector('#failure-count').textContent = failureCount;
    }

    function saveStats() {
        const key = getPageKey();
        chrome.storage.local.get([key], res => {
            const cfg = res[key] || {};
            chrome.storage.local.set({
                [key]: {
                    ...cfg,
                    requestCount,
                    successCount,
                    failureCount
                }
            });
        });
    }

    function hasSubmitButton() {
        return [...document.querySelectorAll('button')]
            .some(b => b.innerText.includes('提交'));
    }

    function silentReloadPage() {
        window.onbeforeunload = null;
        window.location.reload();
    }

    async function fetchTask() {
        try {

            if (waitingRefreshAfterHit || answeringTask) return { gotTask: false };

            if (hasSubmitButton()) {
                updatePanel('做题中');
                return { gotTask: false };
            }

            requestCount++;

            const cfg = await new Promise(r =>
                chrome.storage.local.get([getPageKey()], d => r(d[getPageKey()] || {}))
            );

            const missionId = cfg.missionId || currentMissionId;
            const amount = cfg.amount || 3;

            const url = `/api/hits/assigned?mid=${missionId}&amount=${amount}&_=${Date.now()}`;

            const res = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store'
            });

            const json = await res.json();

            if (res.status === 429 || json?.status === 'error') {
                failureCount++;
                dynamicDelay = Math.min(Math.max(RATE_LIMIT_COOLDOWN, dynamicDelay * 1.35), MAX_BACKOFF);
                updatePanel('⏸️ 限流');
                saveStats();
                return { rateLimited: true };
            }

            const list = json?.data || [];

            if (list.length > 0) {
                const task = list[0];

                if (task.id !== lastTaskId) {
                    lastTaskId = task.id;
                    successCount++;

                    updatePanel('✅ 抢到题');
                    saveStats();

                    // ✅ 关键修复：必须整页刷新（你的场景必须 DOM 重载）
                    setTimeout(() => {
                         window.location.replace(window.location.href);
}, 100);

                    return { gotTask: true };
                }
            }

            updatePanel('⏳ 等待中');
            saveStats();
            return { gotTask: false };

        } catch (e) {
            failureCount++;
            dynamicDelay = Math.min(dynamicDelay * 1.2, MAX_BACKOFF);
            updatePanel('❌ 错误');
            saveStats();
            return { gotTask: false };
        }
    }

    async function loop() {
        while (true) {

            const cfg = await new Promise(r =>
                chrome.storage.local.get([getPageKey()], d => r(d[getPageKey()] || {}))
            );

            polling = cfg.enabled || false;

            if (polling) {

                if (!manuallyStarted) {
                    updatePanel('⏸️ 待手动开启');

                } else if (answeringTask) {

                    if (hasSubmitButton()) {
                        updatePanel('做题中');
                    } else {
                        answeringTask = false;
                        updatePanel('▶️ 抢题中');
                    }

                } else {
                    const r = await fetchTask();

                    if (!r.gotTask) {
                        updatePanel('▶️ 抢题中');
                    }
                }

            } else {
                dynamicDelay = POLL_INTERVAL;
                waitingRefreshAfterHit = false;
                answeringTask = false;
                manuallyStarted = false;
                updatePanel('⏹️ 已停止');
            }

            await new Promise(r => setTimeout(r, dynamicDelay));
        }
    }

    function bindHotkey() {
        document.addEventListener('keydown', e => {
            if (e.key.toLowerCase() === 'o') {
                const p = document.getElementById('mini-sniper-panel');
                if (!p) return;
                p.style.display = p.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'TOGGLE_STATE') {
            polling = msg.enabled;
            manuallyStarted = msg.enabled;

            if (!msg.enabled) {
                waitingRefreshAfterHit = false;
                answeringTask = false;
            }

            updatePanel(polling ? '▶️ 抢题中' : '⏹️ 已停止');
            sendResponse({ success: true });
        }
    });

    createPanel();
    bindHotkey();

    chrome.storage.local.get([getPageKey()], res => {
        const cfg = res[getPageKey()] || {};
        requestCount = cfg.requestCount || 0;
        successCount = cfg.successCount || 0;
        failureCount = cfg.failureCount || 0;

        updatePanel('⏸️ 待手动开启');
        loop();
    });

})();
}