console.log('[Popup] 初始化');

const missionInput = document.getElementById('mission');
const amountInput = document.getElementById('amount');
const saveBtn = document.getElementById('save');
const toggleBtn = document.getElementById('toggle');
const resetBtn = document.getElementById('reset');
const alertEl = document.getElementById('alert');

const statRequest = document.getElementById('stat-request');
const statSuccess = document.getElementById('stat-success');
const statFailure = document.getElementById('stat-failure');
const statTime = document.getElementById('stat-time');

let currentMissionId = null;
let refreshInterval = null;

function showAlert(message, type = 'info') {
    alertEl.textContent = message;
    alertEl.style.background = type === 'error' ? '#fff7e6' : '#e6f7ff';
    alertEl.style.borderColor = type === 'error' ? '#ffe58f' : '#b5e7ff';
    alertEl.style.color = type === 'error' ? '#ad6800' : '#0050b3';
    alertEl.style.display = 'block';
    
    setTimeout(() => {
        alertEl.style.display = 'none';
    }, 3000);
}

// 获取当前 Tab 的 Mission ID
async function getCurrentMissionId() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                const url = tabs[0].url || '';
                console.log('[Popup] 当前 URL:', url);
                const match = url.match(/mission\/(\d+)/);
                const missionId = match ? parseInt(match[1]) : null;
                console.log('[Popup] 提取的 Mission ID:', missionId);
                resolve(missionId);
            } else {
                resolve(null);
            }
        });
    });
}

function getPageKey(missionId) {
    return `page_${missionId}`;
}

function formatTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

async function loadConfig() {
    currentMissionId = await getCurrentMissionId();
    
    if (!currentMissionId) {
        missionInput.placeholder = '❌ 无法识别 Mission ID';
        missionInput.disabled = true;
        amountInput.disabled = true;
        saveBtn.disabled = true;
        toggleBtn.disabled = true;
        resetBtn.disabled = true;
        showAlert('❌ 无法识别页面的 Mission ID，请确保在 https://ilabel.weixin.qq.com/mission/XXX 页面打开', 'error');
        return;
    }

    console.log('[Popup] 加载配置，Mission ID:', currentMissionId);
    
    const pageKey = getPageKey(currentMissionId);
    console.log('[Popup] 存储 Key:', pageKey);

    chrome.storage.local.get([pageKey], (result) => {
        console.log('[Popup] 从存储读取:', result);
        const pageConfig = result[pageKey] || {};

        missionInput.value = pageConfig.missionId || currentMissionId;
        amountInput.value = pageConfig.amount || 3;
        
        missionInput.disabled = false;
        amountInput.disabled = false;
        saveBtn.disabled = false;
        toggleBtn.disabled = false;
        resetBtn.disabled = false;

        updateToggle(pageConfig.enabled);
        updateStats(pageConfig);
    });
}

function updateToggle(enabled) {
    if (enabled) {
        toggleBtn.className = 'enabled';
        toggleBtn.innerText = '运行中';
    } else {
        toggleBtn.className = 'disabled';
        toggleBtn.innerText = '未开启';
    }
    console.log('[Popup] 更新状态:', enabled);
}

function updateStats(config) {
    const requestCount = config.requestCount || 0;
    const successCount = config.successCount || 0;
    const failureCount = config.failureCount || 0;
    const startTime = config.startTime;

    let runningTime = '0s';
    if (startTime && config.enabled) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        runningTime = formatTime(elapsed);
    }

    statRequest.textContent = requestCount;
    statSuccess.textContent = successCount;
    statFailure.textContent = failureCount;
    statTime.textContent = runningTime;
}

function refreshStats() {
    if (!currentMissionId) return;

    const pageKey = getPageKey(currentMissionId);
    chrome.storage.local.get([pageKey], (result) => {
        const pageConfig = result[pageKey] || {};
        updateStats(pageConfig);
    });
}

saveBtn.addEventListener('click', () => {
    if (!currentMissionId) {
        showAlert('❌ 无法识别页面的 Mission ID', 'error');
        return;
    }

    const missionId = Number(missionInput.value);
    const amount = Number(amountInput.value);

    if (!missionId || !amount) {
        showAlert('❌ 请填写有效的 Mission ID 和任务数量', 'error');
        return;
    }

    const pageKey = getPageKey(currentMissionId);
    
    console.log('[Popup] 保存配置:', { pageKey, missionId, amount });

    chrome.storage.local.get([pageKey], (result) => {
        const pageConfig = result[pageKey] || {};

        const updateData = {
            [pageKey]: {
                ...pageConfig,
                missionId,
                amount,
                enabled: pageConfig.enabled || false,
                requestCount: pageConfig.requestCount || 0,
                successCount: pageConfig.successCount || 0,
                failureCount: pageConfig.failureCount || 0
            }
        };

        console.log('[Popup] 将要设置的数据:', updateData);

        chrome.storage.local.set(updateData, () => {
            console.log('[Popup] 保存完成');
            showAlert('✅ 配置已保存', 'success');
            saveBtn.innerText = '已保存';
            
            setTimeout(() => {
                saveBtn.innerText = '保存配置';
            }, 1000);
        });
    });
});

toggleBtn.addEventListener('click', () => {
    if (!currentMissionId) {
        showAlert('❌ 无法识别页面的 Mission ID', 'error');
        return;
    }

    const pageKey = getPageKey(currentMissionId);
    
    console.log('[Popup] 切换状态，Key:', pageKey);

    chrome.storage.local.get([pageKey], (result) => {
        const pageConfig = result[pageKey] || {};
        const newEnabled = !pageConfig.enabled;
        const startTime = newEnabled ? Date.now() : null;

        console.log('[Popup] 当前启用状态:', pageConfig.enabled, '新状态:', newEnabled);

        const updateData = {
            [pageKey]: {
                missionId: pageConfig.missionId || currentMissionId,
                amount: pageConfig.amount || 3,
                enabled: newEnabled,
                startTime: startTime,
                requestCount: pageConfig.requestCount || 0,
                successCount: pageConfig.successCount || 0,
                failureCount: pageConfig.failureCount || 0
            }
        };

        console.log('[Popup] 将要设置的数据:', updateData);

        chrome.storage.local.set(updateData, () => {
            console.log('[Popup] 状态切换完成');
            updateToggle(newEnabled);
            updateStats(updateData[pageKey]);

            // 通知 content script
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'TOGGLE_STATE',
                        enabled: newEnabled
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('[Popup] Content script 未响应:', chrome.runtime.lastError);
                        } else {
                            console.log('[Popup] Content script 已收到消息');
                        }
                    });
                }
            });
        });
    });
});

resetBtn.addEventListener('click', () => {
    if (!currentMissionId) {
        showAlert('❌ 无法识别页面的 Mission ID', 'error');
        return;
    }

    if (!confirm('确定要重置所有统计数据吗？')) return;

    const pageKey = getPageKey(currentMissionId);

    chrome.storage.local.get([pageKey], (result) => {
        const pageConfig = result[pageKey] || {};

        const updateData = {
            [pageKey]: {
                missionId: pageConfig.missionId || currentMissionId,
                amount: pageConfig.amount || 3,
                enabled: pageConfig.enabled || false,
                startTime: pageConfig.startTime || null,
                requestCount: 0,
                successCount: 0,
                failureCount: 0
            }
        };

        chrome.storage.local.set(updateData, () => {
            console.log('[Popup] 数据已重置');
            showAlert('✅ 统计数据已重置', 'success');
            updateStats(updateData[pageKey]);
        });
    });
});

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Popup] DOM 加载完成');
    loadConfig();
    
    // 每秒刷新一次统计信息
    refreshInterval = setInterval(refreshStats, 1000);
});

// 页面关闭时清理
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});