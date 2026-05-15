```markdown id="x7m2qk"
# iLabel Sniper

一个用于 iLabel 任务页面的 Chrome Content Script 工具，用于任务监控、状态追踪与页面自动刷新控制。

---

## 📦 功能特性

- 🔁 轮询任务接口 `/api/hits/assigned`
- 🧠 任务去重（基于 task.id 防重复处理）
- ⚡ 动态延迟机制（自动限流退避）
- 📊 页面右上角状态面板
- 💾 Chrome 本地存储持久化统计
- 🔄 新任务自动刷新页面
- ⌨️ 快捷键控制面板显示/隐藏

---

## 🧰 使用方法

### 1️⃣ 下载项目

下载并解压项目文件，例如：

```

iLabel-sniper.zip

```

解压后得到文件夹：

```

iLabel-sniper/

```

---

### 2️⃣ 安装到 Chrome 浏览器

1. 打开 Chrome 浏览器
2. 进入扩展管理页面：

```

chrome://extensions/

```

3. 打开右上角 **“开发者模式”**
4. 点击左上角 **“加载已解压的扩展程序”**
5. 选择刚刚解压的：

```

iLabel-sniper 文件夹

```

6. 安装完成后即可使用

---

### 3️⃣ 使用插件

进入 iLabel 任务页面后：

- 插件会自动注入脚本
- 页面右上角会出现状态面板
- 自动开始任务轮询（根据开关状态）

---

### 4️⃣ 快捷键

| 按键 | 功能 |
|------|------|
| O | 显示 / 隐藏状态面板 |

---

## 🧱 整体结构

```

Content Script
│
├── 轮询任务接口
├── 判断 task.id
├── 更新统计数据
├── 保存状态
└── 刷新页面

```

---

## 🔄 运行流程

```

初始化
↓
进入轮询循环
↓
请求任务接口
↓
判断是否新任务
↓
如果是：
→ 保存数据
→ 刷新页面
否则：
→ 继续轮询

````

---

## ⚙️ 配置存储（chrome.storage.local）

```js
page_{missionId} = {
    enabled: boolean,
    missionId: number,
    amount: number,

    requestCount: number,
    successCount: number,
    failureCount: number
}
````

---

## 🌐 接口说明

### 请求接口

```
GET /api/hits/assigned
```

### 参数

| 参数     | 说明       |
| ------ | -------- |
| mid    | 任务ID     |
| amount | 每次获取数量   |
| _      | 时间戳（防缓存） |

---

## 📊 状态面板

右上角浮窗显示：

* 当前状态
* 请求次数
* 成功次数
* 失败次数

---

## ⏱ 运行机制

* 基础轮询：180ms
* 限流冷却：1200ms
* 最大退避：3000ms
* 自动动态调整请求间隔

---

## 🔄 页面刷新逻辑

当检测到新任务时：

```js
window.location.replace(window.location.href)
```

特点：

* 不保留历史记录
* 页面重新加载干净状态
* 用于重新渲染任务内容

---

## 🧠 核心逻辑

### 任务去重

```js
if (task.id !== lastTaskId)
```

避免重复处理同一任务。

---

### 状态控制

* `polling`：是否开启轮询
* `answeringTask`：是否处于任务中
* `waitingRefreshAfterHit`：历史兼容状态

---

## 🛠 调试日志

打开开发者工具可查看：

```
[Content] 已注入
[Content] Mission ID: xxx
[Content] 请求 #
[Content] 抢到题
```

---

## ⚠️ 注意事项

* 仅适用于 Chrome 扩展环境
* 依赖页面 DOM 与接口结构
* 高频请求可能触发限流（已做保护）
* 页面刷新后状态依赖本地存储恢复

---

## 📈 后续优化方向

* WebSocket 替代轮询
* 状态机（FSM）重构
* 多标签页防重复抢任务
* MutationObserver 减少刷新依赖

---
