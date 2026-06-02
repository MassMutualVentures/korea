const SPREADSHEET_ID = '1jURzaVsVgaWIdN4e3VcWgY7FoOYF-VNuTq3uI50rwFw';

const SHEET_NAMES = {
  tasks: 'Tasks',
  history: 'History',
  users: 'Users',
};

const STATUS = {
  pending: '待接收',
  accepted: '已接收',
  proofUploaded: '待确认收款',
  rejected: '已拒绝',
  completed: '已完结',
};

const TASK_TYPES = {
  onlinePayment: '线上支付',
  offlineCollection: '线下收款',
};

const SESSION_HOURS = 12;

const USER_HEADERS = [
  'username',
  'password_hash',
  'password_salt',
  'name',
  'role',
  'active',
  'session_token',
  'session_expires_at',
  'created_at',
];

const TASK_HEADERS = [
  'task_id',
  'title',
  'description',
  'assignee',
  'priority',
  'due_date',
  'dispatcher',
  'created_at',
  'status',
  'confirmed_at',
  'confirmation_note',
  'completed_at',
  'completion_note',
  'updated_at',
  'task_type',
  'online_leader',
  'online_transfer_bank',
  'online_transfer_amount',
  'offline_business_name',
  'offline_company_name',
  'offline_customer_name',
  'offline_datetime',
  'offline_amount',
  'offline_currency',
  'offline_material',
  'offline_times',
  'offline_maintenance_period',
  'offline_tail_customer',
  'offline_contact',
  'offline_address',
  'accepted_by',
  'payment_card_holder',
  'payment_card_number',
  'payment_receiving_bank',
  'offline_collection_date',
  'transfer_proof_file_id',
  'transfer_proof_url',
  'transfer_proof_uploaded_at',
  'receipt_confirmed_at',
];

const HISTORY_HEADERS = TASK_HEADERS.concat(['archived_at']);

function doGet(e) {
  setupSheets_();
  const params = (e && e.parameter) || {};
  if (params.action) return handleApiGet_(params);

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('任务派发系统')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  setupSheets_();
  const params = (e && e.parameter) || {};
  const action = params.action || '';

  if (action === 'uploadTransferProof') {
    const result = uploadTransferProof(params.token, params.taskId, {
      name: params.name,
      mimeType: params.mimeType,
      data: params.data,
    });
    return HtmlService.createHtmlOutput(`<script>window.name=${JSON.stringify(JSON.stringify(result))};</script>OK`);
  }

  return HtmlService.createHtmlOutput('Unsupported action');
}

function setupSheets() {
  setupSheets_();
  return {
    ok: true,
    message: '表格已初始化',
  };
}

function login(username, password) {
  setupSheets_();
  const account = sanitize_(username);
  const plainPassword = String(password || '');
  if (!account || !plainPassword) throw new Error('请输入账号和密码。');

  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.users);
  const rowIndex = findUserRowIndex_(sheet, account);
  if (!rowIndex) throw new Error('账号或密码错误。');

  const user = rowToObject_(USER_HEADERS, sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).getValues()[0]);
  if (String(user.active || '').toUpperCase() === 'FALSE') throw new Error('账号已停用。');

  const expected = hashPassword_(plainPassword, user.password_salt);
  if (expected !== user.password_hash) throw new Error('账号或密码错误。');

  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  user.session_token = token;
  user.session_expires_at = formatDate_(expiresAt);
  sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS.map((header) => user[header] || '')]);

  return {
    token,
    user: userPublic_(user),
    dashboard: getDashboardData(token, ''),
  };
}

function logout(token) {
  setupSheets_();
  const session = getSessionUser_(token);
  if (!session.authorized) return { ok: true };

  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.users);
  const rowIndex = findUserRowIndex_(sheet, session.username);
  if (rowIndex) {
    const user = rowToObject_(USER_HEADERS, sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).getValues()[0]);
    user.session_token = '';
    user.session_expires_at = '';
    sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS.map((header) => user[header] || '')]);
  }
  return { ok: true };
}

function getDashboardData(token, historyKeyword) {
  setupSheets_();
  const user = requireSession_(token);
  const allTasks = getRows_(SHEET_NAMES.tasks, TASK_HEADERS);
  const tasks = filterRowsForUser_(allTasks, user);
  const history = searchHistory_(historyKeyword || '', user);

  return {
    user: userPublic_(user),
    tasks,
    history,
    stats: {
      pending: tasks.filter((item) => item.status === STATUS.pending).length,
      accepted: tasks.filter((item) => item.status === STATUS.accepted).length,
      proofUploaded: tasks.filter((item) => item.status === STATUS.proofUploaded).length,
      rejected: tasks.filter((item) => item.status === STATUS.rejected).length,
      history: history.length,
    },
  };
}

function createTask(token, payload) {
  setupSheets_();
  const user = requireRole_(token, 'dispatch');
  const task = normalizeCreatePayload_(payload, user);
  const now = nowText_();

  const rowObject = Object.assign(emptyTask_(), task, {
    task_id: Utilities.getUuid(),
    dispatcher: user.username,
    created_at: now,
    status: STATUS.pending,
    updated_at: now,
  });

  withLock_(() => {
    getSpreadsheet_().getSheetByName(SHEET_NAMES.tasks)
      .appendRow(TASK_HEADERS.map((header) => rowObject[header] || ''));
  });

  return getDashboardData(token, '');
}

function acceptTask(token, taskId, payload) {
  setupSheets_();
  const user = requireRole_(token, 'receive');
  const response = normalizeAcceptPayload_(payload);
  const now = nowText_();

  withLock_(() => {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.tasks);
    const rowIndex = findTaskRowIndex_(sheet, taskId);
    const task = rowToObject_(TASK_HEADERS, sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length).getValues()[0]);

    if (task.status !== STATUS.pending) throw new Error('只有待接收的任务可以确认接受。');

    if (task.task_type === TASK_TYPES.onlinePayment) {
      if (!response.payment_card_holder || !response.payment_card_number || !response.payment_receiving_bank) {
        throw new Error('线上支付接收时必须填写户主姓名、卡号、收款银行。');
      }
    }

    if (task.task_type === TASK_TYPES.offlineCollection && !response.offline_collection_date) {
      throw new Error('线下收款接收时必须填写收款日期。');
    }

    Object.assign(task, response, {
      status: STATUS.accepted,
      accepted_by: user.username,
      confirmed_at: now,
      updated_at: now,
    });

    if (task.task_type === TASK_TYPES.offlineCollection) {
      Object.assign(task, {
        status: STATUS.completed,
        completed_at: now,
        completion_note: response.confirmation_note || '确认收款',
        receipt_confirmed_at: now,
      });
      archiveTask_(sheet, rowIndex, task, now);
      return;
    }

    sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length)
      .setValues([TASK_HEADERS.map((header) => task[header] || '')]);
  });

  return getDashboardData(token, '');
}

function rejectTask(token, taskId, note) {
  setupSheets_();
  const user = requireRole_(token, 'receive');
  const reason = sanitize_(note);
  if (!reason) throw new Error('拒绝任务时必须填写原因。');

  withLock_(() => {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.tasks);
    const rowIndex = findTaskRowIndex_(sheet, taskId);
    const task = rowToObject_(TASK_HEADERS, sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length).getValues()[0]);

    if (task.status !== STATUS.pending) throw new Error('只有待接收的任务可以拒绝。');

    Object.assign(task, {
      status: STATUS.rejected,
      accepted_by: user.username,
      confirmed_at: nowText_(),
      confirmation_note: reason,
      updated_at: nowText_(),
    });

    sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length)
      .setValues([TASK_HEADERS.map((header) => task[header] || '')]);
  });

  return getDashboardData(token, '');
}

function uploadTransferProof(token, taskId, filePayload) {
  setupSheets_();
  requireRole_(token, 'dispatch');
  const fileInfo = normalizeFilePayload_(filePayload);
  const now = nowText_();

  withLock_(() => {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.tasks);
    const rowIndex = findTaskRowIndex_(sheet, taskId);
    const task = rowToObject_(TASK_HEADERS, sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length).getValues()[0]);

    if (task.task_type !== TASK_TYPES.onlinePayment) throw new Error('只有线上支付任务需要上传汇款图片。');
    if (task.status !== STATUS.accepted) throw new Error('只有已接收的线上支付任务可以上传汇款图片。');

    const savedFile = saveTransferProof_(task, fileInfo);
    Object.assign(task, {
      status: STATUS.proofUploaded,
      transfer_proof_file_id: savedFile.getId(),
      transfer_proof_url: savedFile.getUrl(),
      transfer_proof_uploaded_at: now,
      updated_at: now,
    });

    sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length)
      .setValues([TASK_HEADERS.map((header) => task[header] || '')]);
  });

  return getDashboardData(token, '');
}

function confirmReceipt(token, taskId, note) {
  setupSheets_();
  requireRole_(token, 'receive');
  const now = nowText_();

  withLock_(() => {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.tasks);
    const rowIndex = findTaskRowIndex_(sheet, taskId);
    const task = rowToObject_(TASK_HEADERS, sheet.getRange(rowIndex, 1, 1, TASK_HEADERS.length).getValues()[0]);

    if (task.task_type !== TASK_TYPES.onlinePayment) throw new Error('线下收款任务提交收款日期后会直接完结。');
    if (task.status !== STATUS.proofUploaded || !task.transfer_proof_url) {
      throw new Error('请等待派发方上传汇款图片后再确认收款。');
    }

    Object.assign(task, {
      status: STATUS.completed,
      completed_at: now,
      receipt_confirmed_at: now,
      completion_note: sanitize_(note) || '确认收款',
      updated_at: now,
    });

    archiveTask_(sheet, rowIndex, task, now);
  });

  return getDashboardData(token, '');
}

function searchHistory(token, keyword) {
  setupSheets_();
  const user = requireSession_(token);
  return searchHistory_(keyword || '', user);
}

function createUser(token, username, password, name, role) {
  setupSheets_();
  requireAdmin_(token);
  return createUser_(username, password, name, role || '接收');
}

function createUserFromEditor(username, password, name, role) {
  setupSheets_();
  return createUser_(username, password, name, role || '接收');
}

function resetUserPassword(token, username, newPassword) {
  setupSheets_();
  requireAdmin_(token);
  return resetUserPassword_(username, newPassword);
}

function resetUserPasswordFromEditor(username, newPassword) {
  setupSheets_();
  return resetUserPassword_(username, newPassword);
}

function resetUserPassword_(username, newPassword) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.users);
  const rowIndex = findUserRowIndex_(sheet, username);
  if (!rowIndex) throw new Error('没有找到这个账号。');
  const user = rowToObject_(USER_HEADERS, sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).getValues()[0]);
  const salt = Utilities.getUuid();
  user.password_salt = salt;
  user.password_hash = hashPassword_(newPassword, salt);
  user.session_token = '';
  user.session_expires_at = '';
  sheet.getRange(rowIndex, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS.map((header) => user[header] || '')]);
  return { ok: true };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function handleApiGet_(params) {
  try {
    const action = params.action;
    const token = params.token || '';
    const payload = parsePayload_(params.payload);
    let result;

    if (action === 'login') result = login(params.username, params.password);
    else if (action === 'logout') result = logout(token);
    else if (action === 'setupSheets') result = setupSheets();
    else if (action === 'getDashboardData') result = getDashboardData(token, params.keyword || '');
    else if (action === 'createTask') result = createTask(token, payload);
    else if (action === 'acceptTask') result = acceptTask(token, params.taskId, payload);
    else if (action === 'rejectTask') result = rejectTask(token, params.taskId, params.note || '');
    else if (action === 'confirmReceipt') result = confirmReceipt(token, params.taskId, params.note || '');
    else if (action === 'searchHistory') result = searchHistory(token, params.keyword || '');
    else throw new Error('Unsupported action: ' + action);

    return jsonp_(params.callback, { ok: true, result });
  } catch (error) {
    return jsonp_(params.callback, { ok: false, error: error.message || String(error) });
  }
}

function parsePayload_(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function jsonp_(callback, payload) {
  const safeCallback = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback || '') ? callback : 'callback';
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function normalizeCreatePayload_(payload, user) {
  const data = payload || {};
  const type = sanitize_(data.task_type);
  if (type !== TASK_TYPES.onlinePayment && type !== TASK_TYPES.offlineCollection) throw new Error('请选择任务类型。');

  const common = {
    task_type: type,
    assignee: sanitize_(data.assignee || '接收组'),
    priority: sanitize_(data.priority || '普通'),
    due_date: sanitize_(data.due_date),
    description: sanitize_(data.description),
  };

  if (type === TASK_TYPES.onlinePayment) {
    const online = {
      online_leader: sanitize_(data.online_leader),
      online_transfer_bank: sanitize_(data.online_transfer_bank),
      online_transfer_amount: sanitize_(data.online_transfer_amount),
    };

    if (!online.online_leader) throw new Error('线上支付必须填写组长。');
    if (!online.online_transfer_bank) throw new Error('线上支付必须填写转款银行。');
    if (!online.online_transfer_amount) throw new Error('线上支付必须填写转款金额。');

    return Object.assign(common, online, { title: `线上支付 - ${online.online_transfer_amount}` });
  }

  const offline = {
    offline_business_name: sanitize_(data.offline_business_name),
    offline_company_name: sanitize_(data.offline_company_name),
    offline_customer_name: sanitize_(data.offline_customer_name),
    offline_datetime: sanitize_(data.offline_datetime),
    offline_amount: sanitize_(data.offline_amount),
    offline_currency: sanitize_(data.offline_currency),
    offline_material: sanitize_(data.offline_material),
    offline_times: sanitize_(data.offline_times),
    offline_maintenance_period: sanitize_(data.offline_maintenance_period),
    offline_tail_customer: sanitize_(data.offline_tail_customer || '否'),
    offline_contact: sanitize_(data.offline_contact || '不写'),
    offline_address: sanitize_(data.offline_address),
  };

  [
    'offline_business_name',
    'offline_company_name',
    'offline_customer_name',
    'offline_datetime',
    'offline_amount',
    'offline_currency',
    'offline_material',
    'offline_times',
    'offline_maintenance_period',
    'offline_address',
  ].forEach((field) => {
    if (!offline[field]) throw new Error('线下收款信息未填写完整。');
  });

  return Object.assign(common, offline, { title: `线下收款 - ${offline.offline_customer_name}` });
}

function normalizeAcceptPayload_(payload) {
  const data = payload || {};
  return {
    payment_card_holder: sanitize_(data.payment_card_holder),
    payment_card_number: sanitize_(data.payment_card_number),
    payment_receiving_bank: sanitize_(data.payment_receiving_bank),
    offline_collection_date: sanitize_(data.offline_collection_date),
    confirmation_note: sanitize_(data.confirmation_note),
  };
}

function normalizeFilePayload_(payload) {
  const data = payload || {};
  const name = sanitize_(data.name || 'transfer-proof.png');
  const mimeType = sanitize_(data.mimeType || 'image/png');
  const content = String(data.data || '').replace(/^data:[^;]+;base64,/, '');

  if (!content) throw new Error('请先选择汇款图片。');
  if (mimeType.indexOf('image/') !== 0) throw new Error('只能上传图片文件。');
  return { name, mimeType, content };
}

function saveTransferProof_(task, fileInfo) {
  const folder = getOrCreateUploadFolder_();
  const safeName = `${task.task_id}-${fileInfo.name}`.replace(/[\\/:*?"<>|]/g, '-');
  const blob = Utilities.newBlob(Utilities.base64Decode(fileInfo.content), fileInfo.mimeType, safeName);
  return folder.createFile(blob);
}

function getOrCreateUploadFolder_() {
  const folderName = 'TaskFlow Transfer Proofs';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

function setupSheets_() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, SHEET_NAMES.users, USER_HEADERS);
  ensureSheet_(ss, SHEET_NAMES.tasks, TASK_HEADERS);
  ensureSheet_(ss, SHEET_NAMES.history, HISTORY_HEADERS);
  ensureInitialAdmin_();
}

function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const currentWidth = Math.max(sheet.getLastColumn(), headers.length, 1);
  const existingHeaders = sheet.getRange(1, 1, 1, currentWidth).getValues()[0].map((value) => String(value || '').trim());
  const needsHeaderRefresh = headers.some((header, index) => existingHeaders[index] !== header);

  if (needsHeaderRefresh) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
}

function ensureInitialAdmin_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.users);
  if (sheet.getLastRow() > 1) return;
  createUser_('admin', 'admin123456', '系统管理员', '管理员');
}

function createUser_(username, password, name, role) {
  const account = sanitize_(username);
  const plainPassword = String(password || '');
  if (!account) throw new Error('账号不能为空。');
  if (plainPassword.length < 6) throw new Error('密码至少 6 位。');

  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.users);
  if (findUserRowIndex_(sheet, account)) throw new Error('账号已存在。');

  const salt = Utilities.getUuid();
  sheet.appendRow([
    account,
    hashPassword_(plainPassword, salt),
    salt,
    sanitize_(name || account),
    sanitize_(role || '接收'),
    'TRUE',
    '',
    '',
    nowText_(),
  ]);

  return { ok: true, username: account };
}

function getSessionUser_(token) {
  const sessionToken = sanitize_(token);
  if (!sessionToken) return { authorized: false, message: '请先登录。' };

  const rows = getRows_(SHEET_NAMES.users, USER_HEADERS, false);
  const user = rows.find((item) => item.session_token === sessionToken);
  if (!user) return { authorized: false, message: '登录已失效，请重新登录。' };
  if (String(user.active || '').toUpperCase() === 'FALSE') return { authorized: false, message: '账号已停用。' };

  const expiresAt = parseDate_(user.session_expires_at);
  if (!expiresAt || expiresAt.getTime() < Date.now()) return { authorized: false, message: '登录已过期，请重新登录。' };

  const permissions = parsePermissions_(user.role);
  return Object.assign({}, user, permissions, { authorized: true, message: '' });
}

function requireSession_(token) {
  const user = getSessionUser_(token);
  if (!user.authorized) throw new Error(user.message || '请先登录。');
  return user;
}

function requireRole_(token, required) {
  const user = requireSession_(token);
  if (required === 'dispatch' && !user.canDispatch) throw new Error('当前账号没有派发权限。');
  if (required === 'receive' && !user.canReceive) throw new Error('当前账号没有接收权限。');
  return user;
}

function requireAdmin_(token) {
  const user = requireSession_(token);
  if (!user.isAdmin) throw new Error('当前账号没有管理员权限。');
  return user;
}

function userPublic_(user) {
  const permissions = parsePermissions_(user.role);
  return {
    username: user.username || '',
    name: user.name || '',
    role: user.role || '',
    authorized: !!user.authorized || !!user.username,
    canDispatch: permissions.canDispatch,
    canReceive: permissions.canReceive,
    isAdmin: permissions.isAdmin,
  };
}

function parsePermissions_(roleText) {
  const text = String(roleText || '').toLowerCase();
  const isAdmin = text.indexOf('管理员') !== -1 || text.indexOf('admin') !== -1;
  return {
    isAdmin,
    canDispatch: isAdmin || text.indexOf('派发') !== -1 || text.indexOf('dispatch') !== -1,
    canReceive: isAdmin || text.indexOf('接收') !== -1 || text.indexOf('接受') !== -1 || text.indexOf('receive') !== -1,
  };
}

function filterRowsForUser_(rows, user) {
  if (user.isAdmin || user.canDispatch) return rows;
  if (!user.canReceive) return [];
  return rows.filter((item) => {
    if (item.status === STATUS.pending) return true;
    return String(item.accepted_by || '').toLowerCase() === String(user.username || '').toLowerCase();
  });
}

function searchHistory_(keyword, user) {
  const normalized = String(keyword || '').trim().toLowerCase();
  let rows = getRows_(SHEET_NAMES.history, HISTORY_HEADERS);
  rows = filterRowsForUser_(rows, user);

  if (!normalized) return rows.slice(0, 100);
  return rows.filter((item) => {
    return HISTORY_HEADERS.some((header) => String(item[header] || '').toLowerCase().indexOf(normalized) !== -1);
  }).slice(0, 100);
}

function getRows_(sheetName, headers, sortRows) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => rowToObject_(headers, row));

  if (sortRows === false) return rows;
  return rows.sort((a, b) => String(b.updated_at || b.archived_at || b.created_at).localeCompare(String(a.updated_at || a.archived_at || a.created_at)));
}

function rowToObject_(headers, row) {
  return headers.reduce((object, header, index) => {
    object[header] = formatCell_(row[index]);
    return object;
  }, {});
}

function findUserRowIndex_(sheet, username) {
  const account = sanitize_(username).toLowerCase();
  if (!account || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const index = values.findIndex((row) => String(row[0] || '').trim().toLowerCase() === account);
  return index === -1 ? 0 : index + 2;
}

function findTaskRowIndex_(sheet, taskId) {
  const id = sanitize_(taskId);
  if (!id) throw new Error('任务 ID 不能为空。');
  if (sheet.getLastRow() < 2) throw new Error('没有可操作的任务。');

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const index = values.findIndex((row) => String(row[0]) === id);
  if (index === -1) throw new Error('没有找到这个任务，可能已被其他人处理。');
  return index + 2;
}

function archiveTask_(tasksSheet, rowIndex, task, archivedAt) {
  const historySheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.history);
  historySheet.appendRow(HISTORY_HEADERS.map((header) => {
    if (header === 'archived_at') return archivedAt;
    return task[header] || '';
  }));
  tasksSheet.deleteRow(rowIndex);
}

function emptyTask_() {
  return TASK_HEADERS.reduce((object, header) => {
    object[header] = '';
    return object;
  }, {});
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || '') + String(password || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map((byte) => {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function sanitize_(value) {
  return String(value || '').trim();
}

function nowText_() {
  return formatDate_(new Date());
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function parseDate_(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCell_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate_(value);
  return value === null || value === undefined ? '' : String(value);
}
