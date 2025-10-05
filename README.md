# beauty_face

一个基于 H5 的美颜换脸 Demo，提供实时摄像头预览、离线模型管理以及基础的趣味滤镜体验。页面会自动适配手机与 PC 浏览器，推荐使用 Chrome 或 Safari 访问。

## 功能特性

- 顶部 80% 区域实时展示设备摄像头画面，支持缩放、前后摄像头切换及闪光灯控制（取决于硬件能力）。
- 底部 20% 控制面板提供小狗脸趣味滤镜、美白 / 瘦脸 / 大眼 / 自动美妆等美颜调节。
- 内置离线模型管理，可在联网时下载更新模型库，断网后继续使用。
- 若下载模型或素材耗时，提供进度条及提示信息。
- 支持 Service Worker 预缓存，实现离线运行。

## 本地开发

```bash
# 启动本地静态服务器
npx http-server public
# 或者使用 python
python -m http.server --directory public 4173
```

访问 `http://localhost:8080`（或对应端口）即可查看效果。

> ⚠️ 需要通过 HTTPS 或 localhost 打开页面，浏览器才允许访问摄像头和 FaceDetector API。

## 结构说明

- `public/index.html`：应用入口页面。
- `public/styles.css`：整体样式与布局定义。
- `public/app.js`：摄像头控制、滤镜渲染、模型管理、离线处理逻辑。
- `public/service-worker.js`：Service Worker，负责静态资源缓存。
- `public/models/`：内置模型清单与示例配置。

## 浏览器支持

- 建议使用最新版 Chrome 或 Safari。
- FaceDetector API 当前仍在逐步落地，若浏览器暂不支持，将退化为仅提供基础滤镜与美颜调整效果。

## 授权许可

MIT
