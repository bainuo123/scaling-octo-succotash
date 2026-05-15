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
    console.log('[Content] Mission ID:', currentMissionId);

    if (!currentMissionId) {
        console.error('[Content] 无法提取 Mission ID');
        return;
    }

    function getPageKey() {
        return `page_${currentMissionId}`;
    }

    function createPanel() {
        setTimeout(() => {
            if (document.getElementById('mini-sniper-panel')) {
                return;
            }

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
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                z-index: 999999;
                font-size: 12px;
                color: #333;
            `;

            panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <strong style="font-size: 14px;">iLabel Sniper</strong>
                    <span style="font-size: 10px; color: #999;">O键切换</span>
                </div>
                <div style="border-top: 1px solid #f0f0f0; padding-top: 12px;">
                    <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                        <span style="color: #666;">状态:</span>
                        <span id="status-text" style="font-weight: bold; color: #1890ff;">初始化</span>
                    </div>
                    <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                        <span style="color: #666;">请求:</span>
                        <span id="request-count" style="font-weight: bold;">0</span>
                    </div>
                    <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                        <span style="color: #666;">成功:</span>
                        <span id="success-count" style="font-weight: bold; color: #52c41a;">0</span>
                    </div>
                    <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                        <span style="color: #666;">失败:</span>
                        <span id="failure-count" style="font-weight: bold; color: #ff4d4f;">0</span>
                    </div>
                    <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                        <span style="color: #666;">时长:</span>
                        <span id="running-time" style="font-weight: bold;">0s</span>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);
            console.log('[Content] 面板已创建');
        }, 100);
    }

    function updatePanel(status) {
        const panel = document.getElementById('mini-sniper-panel');
        if (!panel) return;

        const statusText = panel.querySelector('#status-text');
        const requestCountEl = panel.querySelector('#request-count');
        const successCountEl = panel.querySelector('#success-count');
        const failureCountEl = panel.querySelector('#failure-count');

        if (statusText) statusText.textContent = status;
        if (requestCountEl) requestCountEl.textContent = requestCount;
        if (successCountEl) successCountEl.textContent = successCount;
        if (failureCountEl) failureCountEl.textContent = failureCount;
    }

    function updateRunningTime() {
        const panel = document.getElementById('mini-sniper-panel');
        if (!panel || !polling) return;

        const pageKey = getPageKey();
        chrome.storage.local.get([pageKey], (data) => {
            const pageConfig = data[pageKey] || {};
            if (pageConfig.startTime) {
                const elapsed = Math.floor((Date.now() - pageConfig.startTime) / 1000);
                const timeEl = panel.querySelector('#running-time');
                if (timeEl) {
                    timeEl.textContent = formatTime(elapsed);
                }
            }
        });
    }

    function formatTime(seconds) {
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m${s}s`;
    }

    function saveStats() {
        const pageKey = getPageKey();
        chrome.storage.local.get([pageKey], (result) => {
            const pageConfig = result[pageKey] || {};
            chrome.storage.local.set({
                [pageKey]: {
                    ...pageConfig,
                    requestCount,
                    successCount,
                    failureCount
                }
            });
        });
    }

    function hasSubmitButton() {
        return [...document.querySelectorAll('button')].some(btn => {
            return btn.innerText.includes('提交');
        });
    }

    function clickRefreshButton() {
        const now = Date.now();
        if (now - lastRefreshClickAt < REFRESH_CLICK_INTERVAL) {
            return false;
        }

        const buttons = [...document.querySelectorAll('button')];
        const refreshBtn = buttons.find(btn => btn.innerText && btn.innerText.trim() === '刷新');
        if (!refreshBtn || refreshBtn.disabled) {
            return false;
        }
        lastRefreshClickAt = now;
        refreshBtn.click();
        console.log('[Content] 🔄 已点击页面刷新按钮');
        return true;
    }

    async function fetchTask() {
        try {
            if (waitingRefreshAfterHit || answeringTask) {
                return { gotTask: false, rateLimited: false };
            }

            // 做题状态暂停抢题
            if (hasSubmitButton()) {
                updatePanel('做题中');
                return { gotTask: false, rateLimited: false };
            }

            requestCount++;
            console.log('[Content] 📤 请求 #' + requestCount);

            const pageKey = getPageKey();
            const pageConfig = await new Promise((resolve) => {
                chrome.storage.local.get([pageKey], (data) => {
                    resolve(data[pageKey] || {});
                });
            });

            const missionId = pageConfig.missionId || currentMissionId;
            const amount = pageConfig.amount || 3;

            const apiUrl = `/api/hits/assigned?mid=${missionId}&amount=${amount}&_=${Date.now()}`;
            console.log('[Content] 🔗 API:', apiUrl);

            const res = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'pragma': 'no-cache',
                    'cache-control': 'no-cache'
                }
            });

            console.log('[Content] 📊 状态:', res.status);

            const json = await res.json();
            console.log('[Content] 📋 数据:', json);

            if (res.status === 429 || json?.status === 'error') {
                const isRateLimited = res.status === 429 || `${json?.msg || ''}`.includes('ratelimit');
                if (isRateLimited) {
                    failureCount++;
                    dynamicDelay = Math.min(Math.max(RATE_LIMIT_COOLDOWN, Math.floor(dynamicDelay * 1.35)), MAX_BACKOFF);
                    updatePanel(`⏸️ 限流(${Math.ceil(dynamicDelay / 1000)}s)`);
                    saveStats();
                    return { gotTask: false, rateLimited: true };
                }
            }

            dynamicDelay = Math.max(POLL_INTERVAL, dynamicDelay - 120);

            const list = json?.data || [];

            if (list.length > 0) {
                const task = list[0];

                if (task.id !== lastTaskId) {
                    lastTaskId = task.id;
                    successCount++;
                    console.log('[Content] ✅ 成功! #' + successCount);
                    updatePanel('✅ 抢到题');
                    saveStats();

                    waitingRefreshAfterHit = true;

                    return { gotTask: true, rateLimited: false };
                }
            }

            updatePanel('⏳ 等待中');
            saveStats();
            return { gotTask: false, rateLimited: false };

        } catch (e) {
            if (e.name !== 'AbortError') {
                failureCount++;
                dynamicDelay = Math.min(Math.floor(dynamicDelay * 1.2), MAX_BACKOFF);
                console.error('[Content] 💥', e);
                updatePanel('❌ 错误');
                saveStats();
            }
            return { gotTask: false, rateLimited: false };
        }
    }

    async function loop() {
        console.log('[Content] 🎬 循环开始');
        let count = 0;
        
        while (true) {
            count++;
            const pageKey = getPageKey();
            
            const pageConfig = await new Promise((resolve) => {
                chrome.storage.local.get([pageKey], (data) => {
                    resolve(data[pageKey] || {});
                });
            });

            polling = pageConfig.enabled || false;

            if (count % 50 === 0) {
                console.log('[Content] 循环 #' + count + ', 启用:' + polling);
            }

            if (polling) {
                if (!manuallyStarted) {
                    updatePanel('⏸️ 待手动开启');
                } else if (waitingRefreshAfterHit) {
                    if (clickRefreshButton()) {
                        updatePanel('🔄 刷新题目中');
                    } else {
                        updatePanel('⏳ 等待刷新按钮');
                    }

                    if (hasSubmitButton()) {
                        waitingRefreshAfterHit = false;
                        answeringTask = true;
                        updatePanel('📝 题目已加载');
                    }
                } else if (answeringTask) {
                    if (hasSubmitButton()) {
                        updatePanel('做题中');
                    } else {
                        answeringTask = false;
                        updatePanel('▶️ 继续抢题');
                    }
                } else {
                    const result = await fetchTask();
                    updateRunningTime();
                    if (!result.gotTask && !result.rateLimited) {
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
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'o') {
                const panel = document.getElementById('mini-sniper-panel');
                if (!panel) return;
                hidden = !hidden;
                panel.style.display = hidden ? 'none' : 'block';
                console.log('[Content] ⌨️', hidden ? '隐藏' : '显示');
            }
        });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[Content] 📨', message);
        if (message.type === 'TOGGLE_STATE') {
            polling = message.enabled;
            manuallyStarted = message.enabled;
            if (!message.enabled) {
                waitingRefreshAfterHit = false;
                answeringTask = false;
            }
            updatePanel(polling ? '▶️ 抢题中' : '⏹️ 已停止');
            sendResponse({ success: true });
        }
    });

    // 初始化
    console.log('[Content] 🔧 初始化');
    createPanel();
    bindHotkey();

    const pageKey = getPageKey();
    chrome.storage.local.get([pageKey], (result) => {
        const pageConfig = result[pageKey] || {};
        polling = false;
        manuallyStarted = false;
        requestCount = pageConfig.requestCount || 0;
        successCount = pageConfig.successCount || 0;
        failureCount = pageConfig.failureCount || 0;

        console.log('[Content] 📋', { polling, requestCount, successCount, failureCount });

        updatePanel('⏸️ 待手动开启');
        loop();
    });

})();
}
