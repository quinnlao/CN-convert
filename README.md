# 繁简转换器

一个完全在浏览器本地运行的 TXT / EPUB 中文繁简转换工具。文件不会上传到服务器，也不依赖后端、数据库或外部 API。

## 功能

- 简体中文转换为繁體中文
- 繁體中文转换为简体中文
- 只转换繁简字形，不替换地区用语，不改写措辞、语序或作者表达
- 支持 UTF-8 TXT，并保留 UTF-8 BOM、原始换行、空行、空格、Tab 和缩进
- 支持多章节 EPUB，只修改 OPF spine 指向的正文 XHTML/HTML 文本节点
- 保留 EPUB 的标签、属性、CSS、图片、字体、目录、元数据与文件路径
- 按 EPUB ZIP 规范打包：`mimetype` 为第一个条目且不压缩
- 响应式界面，可直接部署到 GitHub Pages

转换由 [opencc-js](https://github.com/nk2028/opencc-js) 在浏览器中完成，ZIP 读取与打包使用 [JSZip](https://stuk.github.io/jszip/)。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

Vite 会输出本地访问地址，默认通常为 `http://localhost:5173`。

## 构建与测试

```bash
npm test
npm run build
```

构建产物位于 `dist/`。也可以在本地预览生产构建：

```bash
npm run preview
```

## GitHub Pages 部署

项目已包含 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。Vite 使用相对 `base`，因此静态资源可在 `https://用户名.github.io/仓库名/` 这类仓库子路径下正确加载。

1. 将仓库推送到 GitHub，并确保默认分支为 `main`。
2. 打开仓库的 **Settings → Pages**。
3. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
4. 推送到 `main`，或在 Actions 页面手动运行 `Deploy to GitHub Pages`。
5. Workflow 会执行 `npm ci`、`npm run build`，随后将 `dist/` 部署到 GitHub Pages。

## 格式保持策略

TXT 直接从原始字节解码为 UTF-8，仅将字符串交给 OpenCC，之后按原 BOM 状态编码。代码不执行 trim、换行转换、空白归一化或格式化。

EPUB 不会提取正文后重新生成书籍。它通过 `META-INF/container.xml` 定位 OPF，再根据 manifest 与 spine 逐个处理正文文件。转换器扫描原始 XHTML/HTML 源码，只替换 `<body>` 内的文本片段，标签、属性、注释、CDATA、脚本、样式及 SVG 内容保持原样；未修改的 ZIP 条目使用原始字节重新写入。

由于 EPUB 必须重新生成 ZIP 容器，ZIP 条目的压缩结果可能与源文件逐字节不同，但条目内容与目录结构会被保留。除正文文本外，CSS、图片、字体、导航与元数据文件不会被修改。

## 隐私

所有文件读取、转换与下载都发生在当前浏览器页面中。项目不包含上传逻辑、网络 API 或服务器端文件处理。
