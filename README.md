# Google Sheet 任务派发网页

这是一个基于 Google Sheet 作为数据库、Google Apps Script 作为后端的任务派发系统。流程是：

1. 管理员在 `Users` 表给账号划分权限。
2. 派发账号创建线上支付或线下收款任务。
3. 接收账号在网页里处理任务。
4. 已完结任务会从 `Tasks` 表移动到 `History` 表。
5. 历史任务可按标题、负责人、金额、银行、备注等字段搜索。

## 文件

- `Code.gs`：Apps Script 后端逻辑。
- `index.html`：登录页，登录后按权限进入对应工作台。
- `dispatch.html`：派发方工作台。
- `receive.html`：接收方工作台。
- `taskflow-api.js`：前端连接 Apps Script 的共享接口。
- `taskflow.css`：共享样式。
- `appsscript.json`：Apps Script 项目配置。

## 部署步骤

### 1. 配置 Apps Script 后端

1. 打开你的 Google Sheet。
2. 点击 `扩展程序` -> `Apps Script`。
3. 把默认的 `Code.gs` 内容替换成本目录的 `Code.gs`。
4. 在 Apps Script 左侧打开 `项目设置`，勾选“在编辑器中显示 appsscript.json 清单文件”。
5. 打开 `appsscript.json`，替换成本目录的 `appsscript.json`。
6. 回到 `Code.gs`，运行一次 `setupSheets`，按提示授权。
7. 点击 `部署` -> `新建部署` -> 类型选择 `Web 应用`。
8. 建议设置：
   - 执行身份：我
   - 访问权限：任何人
9. 部署后复制 Web App URL。

### 2. 配置 GitHub Pages 前端

1. 打开 `Index.html`。
2. 找到这一行：

```js
const APP_SCRIPT_API_URL = '';
```

3. 把 Apps Script Web App URL 填进去，例如：

```js
const APP_SCRIPT_API_URL = 'https://script.google.com/macros/s/xxxxxxx/exec';
```

4. 把这些文件一起上传到 GitHub 仓库根目录：
   - `index.html`
   - `dispatch.html`
   - `receive.html`
   - `taskflow-api.js`
   - `taskflow.css`
5. 在 GitHub 仓库设置里开启 Pages，入口文件是小写的 `index.html`。

线上支付的汇款图片会保存到 Google Drive 的 `TaskFlow Transfer Proofs` 文件夹，Sheet 里保存文件链接。首次授权时会出现 Drive 权限，这是图片上传所需。

## 表结构

系统会自动创建三张表：

### Users

用于登录权限控制。

字段：

- `username`
- `password_hash`
- `password_salt`
- `name`
- `role`
- `active`
- `session_token`
- `session_expires_at`
- `created_at`

首次运行 `setupSheets` 后会自动创建一个临时管理员账号：

```text
账号：admin
密码：admin123456
```

建议马上用 Apps Script 编辑器里的 `resetUserPasswordFromEditor` 改掉默认密码，或创建新管理员并停用默认账号。

`role` 可填写：

- `派发`
- `接收`
- `管理员`
- 也可以写 `派发,接收`，表示同一个账号两种权限都有。

`active` 填 `TRUE` 表示启用，填 `FALSE` 表示停用。

不要手动填写明文密码。新增账号建议在 Apps Script 编辑器里运行：

```js
createUserFromEditor('user01', 'password123', '接收员01', '接收')
```

重置密码运行：

```js
resetUserPasswordFromEditor('admin', 'newPassword123')
```

如果只是测试，也可以先用默认 `admin` 登录。

### Tasks

保存当前未归档任务。

字段：

- `task_id`
- `title`
- `description`
- `assignee`
- `priority`
- `due_date`
- `dispatcher`
- `created_at`
- `status`
- `confirmed_at`
- `confirmation_note`
- `completed_at`
- `completion_note`
- `updated_at`
- `task_type`
- `online_leader`
- `online_transfer_bank`
- `online_transfer_amount`
- `offline_business_name`
- `offline_company_name`
- `offline_customer_name`
- `offline_datetime`
- `offline_amount`
- `offline_currency`
- `offline_material`
- `offline_times`
- `offline_maintenance_period`
- `offline_tail_customer`
- `offline_contact`
- `offline_address`
- `accepted_by`
- `payment_card_holder`
- `payment_card_number`
- `payment_receiving_bank`
- `offline_collection_date`
- `transfer_proof_file_id`
- `transfer_proof_url`
- `transfer_proof_uploaded_at`
- `receipt_confirmed_at`

### History

保存已完结任务，比 `Tasks` 多一个字段：

- `archived_at`

## 状态流转

线上支付：

```text
待接收 -> 已接收 -> 待确认收款 -> 已完结 -> History
```

线上支付规则：

- 派发方填写组长、转款银行、转款金额。
- 派发后开始第一段计时：10 分钟内绿色，11-20 分钟黄色，20 分钟后红色。
- 接收方确认接收时填写户主姓名、卡号、收款银行。
- 接收后开始第二段计时：10 分钟内绿色，11-20 分钟黄色，20 分钟后红色。
- 派发方完成转账后上传汇款图片。
- 接收方点击确认收款后，任务自动完结并进入 `History`。

线下收款：

```text
待接收 -> 已完结 -> History
```

线下收款规则：

- 派发方填写业务名字、公司名、客户名字、日期时间、金额、币种、料子、次数、维护期、是否后期尾刀客户、联系方式、详细地址。
- 接收方提交收款日期后，任务直接完结并进入 `History`。

拒绝流程：

```text
待接收 -> 已拒绝
```

拒绝的任务会留在 `Tasks` 表，方便派发人查看原因后重新派发新任务。

## 可按需扩展

可以继续加这些功能：

- 邮件通知负责人。
- 只显示当前账号负责的任务。
- 管理员角色和负责人角色分离。
- 拒绝后重新分派。
- 附件链接字段。
- 按部门、项目、客户筛选。
- 到期提醒和逾期标记。
