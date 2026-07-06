# Amex Helper

Amex Helper 用于导出 American Express 卡片余额、Membership Rewards 积分和 Benefits 使用状态，输出 CSV 文件。

本仓库直接使用 `dist/` 下的文件：

- `dist/amex-helper.user.js`：油猴脚本，适合单个已登录 Amex 浏览器会话。
- `dist/amex-helper.mjs`：HubStudio 批量导出脚本，适用于导出多个 Amex 账号；一个 HubStudio Profile 对应一个 Amex 账号。

## 油猴脚本

### 安装

- Tampermonkey：`https://www.tampermonkey.net/`
- Violentmonkey：`https://violentmonkey.github.io/`

1. 安装 Tampermonkey 或 Violentmonkey 扩展。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 找到 Tampermonkey 或 Violentmonkey，进入 `Details` / `详细信息`。
4. 如果有 `Allow User Scripts` / `允许用户脚本`，打开它；没有该选项可跳过。
5. 打开扩展控制面板，新建脚本。
6. 删除默认模板，粘贴 `dist/amex-helper.user.js` 的全部内容。
7. 保存脚本，并确认脚本已启用。

匹配页面：

```text
https://global.americanexpress.com/overview
https://global.americanexpress.com/dashboard*
```

### 使用

1. 打开 `https://global.americanexpress.com/overview`。
2. 登录 Amex 账号。
3. 点击右侧 Amex Helper 悬浮按钮。
4. 输入 `Amex Account Index`，例如 `00`。
5. 点击对应按钮导出 CSV。

输出文件：

- `{index}_balance_{yyyymmdd}.csv`
- `{index}_mr_{yyyymmdd}.csv`
- `{index}_benefits_{yyyymmdd}.csv`

## HubStudio 批量导出

### 安装

HubStudio Desktop：

1. 打开 HubStudio 官方下载页：`https://www.hubstudio.cn/download/`。
2. 下载并安装 HubStudio Desktop 客户端。
3. 打开 HubStudio 并登录账号。
4. 创建或导入浏览器环境 Profile；建议一个 Amex 账号对应一个 HubStudio Profile。
5. 记录每个 Profile 的 `containerCode`。
6. 运行脚本前保持 HubStudio 打开，本地 API 默认为 `http://127.0.0.1:6873`。

Node.js 22+：

- 官方下载页：`https://nodejs.org/en/download`

Windows 可使用 `winget` 安装：

```powershell
winget install OpenJS.NodeJS.LTS --source winget
```

Windows 官方安装包：

1. 打开 Node.js 官方下载页：`https://nodejs.org/en/download`。
2. 选择 Windows Installer `.msi`。
3. 下载后双击安装包。
4. 安装时保留默认选项，尤其是 `npm package manager` 和 `Add to PATH`。
5. 安装完成后重新打开 PowerShell 或 Command Prompt。

macOS 官方安装包：从 Node.js 官方下载页下载 `.pkg`，按默认步骤安装。

macOS 如果使用 Homebrew：

```bash
brew install node@24
brew link --overwrite --force node@24
```

macOS / Linux 如果使用 `nvm`：

```bash
nvm install 24
nvm use 24
```

安装完成后验证版本：

```bash
node -v
npm -v
```

`node -v` 应显示 `v22.x` 或更高版本。

不需要安装 ChromeDriver、Selenium 或 Puppeteer。

直接运行 `dist/amex-helper.mjs` 不需要 `npm install`。只有重新构建 `dist/` 时需要：

```bash
npm ci
npm run build
```

示例：

```bash
node dist/amex-helper.mjs \
  --base-url http://127.0.0.1:6873 \
  --profile 1474900026=00 \
  --profile 1474900027=01 \
  --out ./exports \
  --keep-open
```

参数说明：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--base-url <url>` | `http://127.0.0.1:6873` | HubStudio Desktop 本地 API 地址，也可用 `HUBSTUDIO_BASE_URL` 指定。 |
| `--profile <containerCode>=<index>` | 无 | Profile 与 Amex Account Index 的映射；多个 Profile 重复传入。 |
| `--config <file>` | 无 | 从 JSON 配置读取 Profile 列表；可替代 `--profile`。 |
| `--out <dir>` | `./amex_export_{yyyymmdd}` | CSV 输出目录。 |
| `--mode <mode>` | `all` | 可选 `all`、`balance`、`mr`、`benefits`。 |
| `--login-timeout-ms <ms>` | `600000` | 等待手工登录或验证的最长时间。 |
| `--keep-open` | 关闭 | 导出完成后保留 HubStudio 浏览器窗口。 |
| `--help` / `-h` | 无 | 显示帮助。 |

`--config` 示例：

```json
{
  "profiles": [
    { "containerCode": "1474900026", "index": "00", "label": "amex-00" },
    { "containerCode": "1474900027", "index": "01", "label": "amex-01" }
  ]
}
```

只导出 Benefits：

```bash
node dist/amex-helper.mjs \
  --base-url http://127.0.0.1:6873 \
  --profile 1474900026=00 \
  --profile 1474900027=01 \
  --mode benefits \
  --out ./exports \
  --keep-open
```

## CSV 输出

单个 Profile：

- `{index}_balance_{yyyymmdd}.csv`
- `{index}_mr_{yyyymmdd}.csv`
- `{index}_benefits_{yyyymmdd}.csv`

汇总文件：

- `all_balance_{yyyymmdd}.csv`
- `all_mr_{yyyymmdd}.csv`
- `all_benefits_{yyyymmdd}.csv`

MR CSV：

```csv
acc no,cards,mr account,earned,redeemed,35% redeem left,pending,balance
```

Benefits CSV：

```csv
acc no,card,card ending,product,benefit id,benefit name,category,period,status,used amount,total amount,remaining amount,currency,unit,enrollment status,airline code,period start,period end,last updated
```

## 注意事项

- 余额和 Benefits 都只导出 Basic 卡。
- HubStudio 批量导出时，脚本会打开 Profile；如果需要手工登录或验证，在打开的窗口中完成即可。
