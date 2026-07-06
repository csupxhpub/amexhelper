# Amex Helper

Amex Helper 用于导出 American Express 卡片余额、Membership Rewards 积分和 Benefits 使用状态，输出 CSV 文件。

本仓库直接使用 `dist/` 下的文件：

- `dist/amex-helper.user.js`：油猴脚本，适合单个已登录 Amex 浏览器会话。
- `dist/amex-helper.mjs`：HubStudio 批量导出脚本，适用于导出多个 Amex 账号；一个 HubStudio Profile 对应一个 Amex 账号。

## 油猴脚本

### 安装

1. Chrome 安装 Tampermonkey 扩展：`https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo`。
2. 打开 `chrome://extensions/`，进入 Tampermonkey 详情页，开启 `Allow User Scripts`。
3. 新建用户脚本，粘贴 `dist/amex-helper.user.js` 的全部内容。
4. 保存并启用脚本。

### 使用

1. 打开 `https://global.americanexpress.com/overview`。
2. 登录 Amex 账号。
3. 展开右下角 `Amex Helper` 悬浮按钮，输入 `Amex Account Index`，例如 `00`；每个 Amex 账号使用一个独立 Index。
4. 点击对应按钮导出 CSV。

### 说明

输出文件：

- `{index}_balance_{yyyymmdd}.csv`
- `{index}_mr_{yyyymmdd}.csv`
- `{index}_benefits_{yyyymmdd}.csv`

## HubStudio 批量导出

### 安装

1. 安装 HubStudio Desktop：`https://www.hubstudio.cn/download/`。
2. 在 HubStudio 中创建或导入 Profile，一个 Amex 账号对应一个 Profile；在 Profile / 环境列表中查看或复制每个 Profile 的 `containerCode`。
3. 安装 Node.js 22+：`https://nodejs.org/en/download`。
4. 运行脚本前保持 HubStudio Desktop 打开。

### 使用

HubStudio Desktop 本地 API 默认为 `http://127.0.0.1:6873`。
每个 Amex 账号传入一个 `--profile <containerCode>=<index>`；多个账号重复传入多个 `--profile`。

示例：

```bash
node dist/amex-helper.mjs \
  --base-url http://127.0.0.1:6873 \
  --profile 1474900026=00 \
  --profile 1474900027=01 \
  --out ./exports \
  --keep-open
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

### 说明

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

## CSV 字段说明

余额和 Benefits 都只导出 Basic 卡。

单个 Profile：

- `{index}_balance_{yyyymmdd}.csv`
- `{index}_mr_{yyyymmdd}.csv`
- `{index}_benefits_{yyyymmdd}.csv`

汇总文件：

- `all_balance_{yyyymmdd}.csv`
- `all_mr_{yyyymmdd}.csv`
- `all_benefits_{yyyymmdd}.csv`

Balance CSV：

```csv
card,op date,limit,available,st day,st date,st balance,remaining,total balance,pending,final balance,isDue,min due amount,due date,next st date,next due amount,next due date,,card ending,description,account_token,account_key,embossed_name
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `card` | 卡片名称，格式为 `{index}_{product_prefix}_{card_ending}`。 |
| `op date` | 开卡日期。 |
| `limit` | 信用额度；No Preset Spending Limit 卡显示 `unlimited`。 |
| `available` | 可用额度；No Preset Spending Limit 卡显示 `unlimited`。 |
| `st day` | 最近账单日的日期数字，例如 `15.`。 |
| `st date` | 最近账单日期。 |
| `st balance` | 最近一期 statement balance。 |
| `remaining` | 最近一期账单剩余未还金额。 |
| `total balance` | 当前账单余额。 |
| `pending` | Pending 且 Debit 交易金额之和。 |
| `final balance` | `total balance + pending`。 |
| `isDue` | 当前是否有到期付款要求。 |
| `min due amount` | 最低应还金额。 |
| `due date` | 当前付款到期日。 |
| `next st date` | 下一账单日。 |
| `next due amount` | `final balance - remaining`，用于估算下一期应还金额。 |
| `next due date` | 下一账单日后 25 天。 |
| 空字段 | 分隔列，便于把余额字段和卡片元数据分开。 |
| `card ending` | 卡片尾号。 |
| `description` | 卡片产品名称。 |
| `account_token` | Amex account token。 |
| `account_key` | Amex account key。 |
| `embossed_name` | 卡面姓名。 |

Balance CSV 最后一行为 `total`。金额字段保留 2 位小数；如果任一卡片为 `unlimited`，`limit` 和 `available` 汇总显示为非 `unlimited` 数值之和加 `+unlimited`。

MR CSV：

```csv
acc no,cards,mr account,earned,redeemed,35% redeem left,pending,balance
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `acc no` | MR 账户编号，格式为 `{index}_{序号}`，序号从 `00` 开始。 |
| `cards` | 该 MR 账户下的 Business Platinum 卡，格式为 `{card}_{airline code}`；多张卡用换行分隔。 |
| `mr account` | MR 账号。 |
| `earned` | 已获得积分。 |
| `redeemed` | 已使用积分。 |
| `35% redeem left` | Business Platinum 35% Pay With Points 年度返还剩余额度，按 `1000000 * 100 / 35 - redeemed` 估算，最小为 `0`。 |
| `pending` | Pending 积分。 |
| `balance` | 当前可用积分。 |

MR CSV 最后一行为 `total`，汇总 `earned`、`pending` 和 `balance`。没有 Business Platinum 卡时，`cards` 显示 `NA`；Business Platinum 未登记航司时，`airline code` 显示 `NULL`。

Benefits CSV：

```csv
acc no,card,card ending,product,benefit id,benefit name,category,period,status,used amount,total amount,remaining amount,currency,unit,enrollment status,airline code,period start,period end,last updated
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `acc no` | Amex Account Index。 |
| `card` | 卡片名称，格式为 `{index}_{product_prefix}_{card_ending}`。 |
| `card ending` | 卡片尾号。 |
| `product` | 卡片产品名称。 |
| `benefit id` | Benefit 标识。 |
| `benefit name` | Benefit 名称。 |
| `category` | Benefit 分类，由 benefit 名称归类，例如 airline、hotel、dell、wireless、generic。 |
| `period` | Benefit 周期；`CalenderYear` 输出 `Annual`，`Monthly` 输出 `Monthly`，`QuarterYear` 输出 `Quarterly`，`HalfYear` 输出 `Semi-Annual`。 |
| `status` | 使用状态，统一输出为 `Completed`、`In Progress`、`Not Started` 或 `Unknown`。 |
| `used amount` | 已使用金额或数量。 |
| `total amount` | 总额度。 |
| `remaining amount` | 剩余额度。 |
| `currency` | 金额币种。 |
| `unit` | 额度单位。 |
| `enrollment status` | 登记状态；不需要登记时显示 `NOT_REQUIRED`。 |
| `airline code` | 航司类权益的 2 位 IATA 代码；非航司或未登记显示 `NULL`。 |
| `period start` | Benefit 当前周期开始日期。 |
| `period end` | Benefit 当前周期结束日期。 |
| `last updated` | 更新时间；没有数据时为空。 |
