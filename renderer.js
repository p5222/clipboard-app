const { ipcRenderer } = require('electron');

let allHistory = [];
let filteredHistory = [];
let currentSettings = {};

async function init() {
  currentSettings = await ipcRenderer.invoke('get-settings');
  allHistory = await ipcRenderer.invoke('get-history');
  filteredHistory = [...allHistory];

  updateUI();
  updateStats();
  document.getElementById('retentionText').textContent = `保存 ${currentSettings.retentionDays} 天`;
}

function updateUI() {
  const content = document.getElementById('content');

  if (filteredHistory.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div>暂无历史记录</div>
        <div style="margin-top: 10px; font-size: 12px;">复制任何文本或图片后，会自动显示在这里</div>
      </div>
    `;
    return;
  }

  content.innerHTML = filteredHistory.map((item) => createCard(item)).join('');

  document.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;
    const item = filteredHistory.find((entry) => entry.id === id);

    card.addEventListener('click', (event) => {
      if (!event.target.closest('.icon-btn')) {
        copyItem(item);
      }
    });
  });

  document.querySelectorAll('.btn-pin').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = event.target.closest('.card').dataset.id;
      pinItem(id);
    });
  });

  document.querySelectorAll('.btn-delete').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = event.target.closest('.card').dataset.id;
      deleteItem(id);
    });
  });
}

function createCard(item) {
  const time = formatTime(item.timestamp);
  const pinnedClass = item.pinned ? 'pinned' : '';
  const pinnedBadge = item.pinned ? '<span class="pinned-badge">📌 置顶</span>' : '';
  const pinActive = item.pinned ? 'active' : '';

  let contentHtml = '';
  if (item.type === 'text') {
    const preview = item.content.length > 200 ? `${item.content.substring(0, 200)}...` : item.content;
    contentHtml = `<div class="card-content text">${escapeHtml(preview)}</div>`;
  } else if (item.type === 'image') {
    contentHtml = `<div class="card-content image"><img src="${item.content}" alt="剪贴板图片"></div>`;
  }

  return `
    <div class="card ${pinnedClass}" data-id="${item.id}">
      ${pinnedBadge}
      <div class="card-header">
        <div class="card-time">${time}</div>
        <div class="card-actions">
          <button class="icon-btn btn-pin ${pinActive}" title="置顶">📌</button>
          <button class="icon-btn btn-delete" title="删除">🗑️</button>
        </div>
      </div>
      ${contentHtml}
    </div>
  `;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateStats() {
  document.getElementById('statsText').textContent = `共 ${allHistory.length} 条记录`;
}

async function copyItem(item) {
  const success = await ipcRenderer.invoke('copy-item', item);
  if (success) {
    showToast('已复制到剪贴板');
  }
}

async function deleteItem(id) {
  allHistory = await ipcRenderer.invoke('delete-item', id);
  applySearch();
  updateStats();
}

async function pinItem(id) {
  allHistory = await ipcRenderer.invoke('pin-item', id);
  applySearch();
}

async function clearAll() {
  if (confirm('确定要清空所有历史记录吗？')) {
    allHistory = await ipcRenderer.invoke('clear-all');
    filteredHistory = [];
    updateUI();
    updateStats();
  }
}

function applySearch() {
  const keyword = document.getElementById('searchInput').value.toLowerCase().trim();

  if (!keyword) {
    filteredHistory = [...allHistory];
  } else {
    filteredHistory = allHistory.filter((item) => item.type === 'text' && item.content.toLowerCase().includes(keyword));
  }

  updateUI();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: fadeInOut 2s ease-in-out;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    document.body.removeChild(toast);
  }, 2000);
}

document.getElementById('searchInput').addEventListener('input', applySearch);
document.getElementById('clearBtn').addEventListener('click', clearAll);

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('retentionDays').value = currentSettings.retentionDays;
  document.getElementById('settingsModal').classList.add('show');
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('show');
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const retentionDays = parseInt(document.getElementById('retentionDays').value, 10);
  currentSettings.retentionDays = retentionDays;

  await ipcRenderer.invoke('save-settings', currentSettings);
  document.getElementById('retentionText').textContent = `保存 ${retentionDays} 天`;
  document.getElementById('settingsModal').classList.remove('show');

  allHistory = await ipcRenderer.invoke('get-history');
  applySearch();
  updateStats();
  showToast('设置已保存');
});

ipcRenderer.on('history-updated', (event, history) => {
  allHistory = history;
  applySearch();
  updateStats();
});

const style = document.createElement('style');
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    10% { opacity: 1; transform: translateX(-50%) translateY(0); }
    90% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  }
`;
document.head.appendChild(style);

init();
