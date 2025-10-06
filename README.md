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

### 下载 Human 模型文件

`Human` 人脸检测器默认会尝试从 `public/models` 目录加载模型权重。首次克隆仓库后，请在联网环境下执行以下脚本，将最新模型下载到本地：

```bash
python scripts/download_models.py
```

脚本会读取官方清单并将所有 JSON 与二进制权重保存到 `public/models/`。若需要重新下载，可附加 `--force` 参数。下载完成后再次通过 HTTPS 启动服务即可避免 `404` 模型加载错误。

## HTTPS 启动指南

若需要在纯 IP 地址环境下通过 HTTPS 访问（例如内网设备没有域名，仅能使用 `https://<ip>`），可以按照以下步骤生成证书并在本地服务器绑定：

1. **生成自签名证书（包含 IP Subject Alternative Name）**

   ```bash
   # 将 <ip_address> 替换为你实际访问的 IP，例如 192.168.0.10
   export TARGET_IP=<ip_address>

   cat >openssl.cnf <<EOF
   [req]
   default_bits       = 2048
   prompt             = no
   default_md         = sha256
   req_extensions     = req_ext
   distinguished_name = dn

   [dn]
   C  = CN
   ST = Local
   L  = Dev
   O  = BeautyFace
   OU = Lab
   CN = ${TARGET_IP}

   [req_ext]
   subjectAltName = IP:${TARGET_IP}
   EOF

   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout beauty_face.key -out beauty_face.crt -config openssl.cnf
   ```

   - `beauty_face.crt`：公钥证书。
   - `beauty_face.key`：私钥文件。
   - 证书有效期默认为 365 天，可根据需要调整 `-days` 参数。

2. **信任证书**

   - macOS：双击 `beauty_face.crt` 导入「钥匙串访问」，在「系统」钥匙串中将信任设置为「始终信任」。
   - Windows：右键证书选择“安装证书”，导入到“受信任的根证书颁发机构”。
   - Linux：根据发行版将证书复制到系统信任目录（例如 `/usr/local/share/ca-certificates/`）并执行 `sudo update-ca-certificates`。

3. **启动支持 HTTPS 的静态服务器**

   使用 `http-server`：

   ```bash
   npx http-server public --ssl --cert beauty_face.crt --key beauty_face.key --host 0.0.0.0 --port 8443
   ```

   或者使用 `python` 内置模块：

   ```bash
   python -m http.server 8443 --directory public --bind 0.0.0.0 \
     --ssl-certfile beauty_face.crt --ssl-keyfile beauty_face.key
   ```

   将服务器绑定到 `0.0.0.0` 以便通过局域网 IP 访问。

4. **通过 HTTPS 访问**

   在浏览器中访问 `https://<ip_address>:8443`，确认地址栏显示安全锁图标即可正常访问摄像头。

> 如果需要为多个 IP 或域名签发自签名证书，可在 `subjectAltName` 中添加多个条目，例如 `subjectAltName = IP:192.168.0.10,IP:127.0.0.1,DNS:example.com`。

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
