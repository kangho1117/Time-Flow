/* ============================================
   TimeFlow — Frontend Application Logic
   (API-backed with SQLite)
   ============================================ */

// ==================== API CLIENT ====================

const API = {
  getToken() {
    return localStorage.getItem('tf_token');
  },
  setToken(token) {
    localStorage.setItem('tf_token', token);
  },
  clearToken() {
    localStorage.removeItem('tf_token');
  },

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`/api${path}`, options);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  },

  // Auth
  register(username, email, password) {
    return this.request('POST', '/auth/register', { username, email, password });
  },
  login(username, password) {
    return this.request('POST', '/auth/login', { username, password });
  },
  logout() {
    return this.request('POST', '/auth/logout');
  },
  getMe() {
    return this.request('GET', '/auth/me');
  },

  // Projects
  getProjects(status) {
    const query = status ? `?status=${status}` : '';
    return this.request('GET', `/projects${query}`);
  },
  createProject(name, description, color) {
    return this.request('POST', '/projects', { name, description, color });
  },
  deleteProject(id) {
    return this.request('DELETE', `/projects/${id}`);
  },
  completeProject(id) {
    return this.request('PATCH', `/projects/${id}/complete`);
  },
  reopenProject(id) {
    return this.request('PATCH', `/projects/${id}/reopen`);
  },

  // Entries
  getEntries() {
    return this.request('GET', '/entries');
  },
  createEntry(projectId, startTime, endTime, duration, note) {
    return this.request('POST', '/entries', { projectId, startTime, endTime, duration, note });
  },
  deleteEntry(id) {
    return this.request('DELETE', `/entries/${id}`);
  },

  // Stats & Chart
  getStats() {
    return this.request('GET', '/stats');
  },
  getChartData() {
    return this.request('GET', '/chart-data');
  }
};


// ==================== UTILITY FUNCTIONS ====================

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationShort(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today - entryDate;

  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// ==================== APP STATE ====================

let currentUser = null;
let timerInterval = null;
let deleteProjectId = null;
let completeProjectId = null;
let pendingTimerStop = null;
let currentProjectTab = 'active';

// Cached data from API
let cachedProjects = [];
let cachedEntries = [];


// ==================== TOAST NOTIFICATIONS ====================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ==================== VIEW MANAGEMENT ====================

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(viewId);
  target.style.display = 'none';
  target.offsetHeight;
  target.style.display = '';
  target.classList.add('active');
}

function showLogin() {
  document.getElementById('login-form').style.display = '';
  document.getElementById('register-form').style.display = 'none';
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = '';
}


// ==================== AUTH HANDLERS ====================

async function handleRegister(e) {
  e.preventDefault();

  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;

  if (password !== passwordConfirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  try {
    await API.register(username, email, password);
    showToast('Account created! Please sign in.', 'success');
    showLogin();
    e.target.reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const data = await API.login(username, password);
    API.setToken(data.token);
    currentUser = data.user;

    showToast(`Welcome back, ${currentUser.username}!`, 'success');
    enterDashboard();
    e.target.reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleLogout() {
  // Stop active timer UI
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  localStorage.removeItem('tf_active_timer');

  try {
    await API.logout();
  } catch (err) {
    // Ignore logout errors
  }

  API.clearToken();
  currentUser = null;

  showView('auth-view');
  showLogin();
  showToast('You have been logged out.', 'info');
}


// ==================== DASHBOARD ====================

async function enterDashboard() {
  showView('dashboard-view');

  const avatar = document.getElementById('user-avatar');
  const displayName = document.getElementById('user-display-name');
  avatar.textContent = currentUser.username.charAt(0).toUpperCase();
  displayName.textContent = currentUser.username;

  // Restore active timer if any
  const activeTimer = getActiveTimer();
  if (activeTimer) {
    resumeTimer(activeTimer);
  }

  await renderDashboard();
}

async function renderDashboard() {
  await Promise.all([
    renderStats(),
    renderProjects(),
    renderRecentEntries(),
    renderChart()
  ]);
}

async function renderStats() {
  try {
    const stats = await API.getStats();
    document.getElementById('stat-today-time').textContent = formatDurationShort(stats.todayTime);
    document.getElementById('stat-project-count').textContent = stats.projectCount;
    document.getElementById('stat-week-time').textContent = formatDurationShort(stats.weekTime);
    document.getElementById('stat-total-entries').textContent = stats.entryCount;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function renderProjects() {
  try {
    cachedProjects = await API.getProjects(currentProjectTab);
  } catch (err) {
    console.error('Failed to load projects:', err);
    return;
  }

  const grid = document.getElementById('projects-grid');
  const noProjects = document.getElementById('no-projects');

  if (cachedProjects.length === 0) {
    grid.style.display = 'none';
    noProjects.style.display = '';
    noProjects.querySelector('h3').textContent = currentProjectTab === 'completed' ? 'No completed projects' : 'No projects yet';
    noProjects.querySelector('p').textContent = currentProjectTab === 'completed' ? 'Complete a project to see it here.' : 'Create a new project to start tracking time!';
    return;
  }

  grid.style.display = '';
  noProjects.style.display = 'none';

  const activeTimer = getActiveTimer();

  // We need entries per project for the card stats
  try {
    cachedEntries = await API.getEntries();
  } catch (err) {
    cachedEntries = [];
  }

  const isCompleted = currentProjectTab === 'completed';

  grid.innerHTML = cachedProjects.map(project => {
    const projectEntries = cachedEntries.filter(e => e.project_id === project.id);
    const totalMs = projectEntries.reduce((sum, e) => sum + e.duration, 0);
    const isTimerActive = activeTimer && activeTimer.projectId === project.id;

    return `
      <div class="project-card glass-card ${isCompleted ? 'completed' : ''}" style="--project-color: ${project.color};" id="project-${project.id}">
        <div class="project-card-header">
          <h3 class="project-card-title">${escapeHtml(project.name)}</h3>
          <div style="display:flex;gap:0.25rem;">
            ${isCompleted
              ? `<button class="project-menu-btn" onclick="reopenProject('${project.id}')" title="Reopen">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                </button>`
              : `<button class="project-menu-btn" onclick="openCompleteProject('${project.id}')" title="Complete">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </button>`
            }
            <button class="project-menu-btn" onclick="openDeleteProject('${project.id}')" title="Delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
        ${isCompleted ? '<div class="project-completed-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Completed</div>' : ''}
        ${project.description ? `<p class="project-card-desc">${escapeHtml(project.description)}</p>` : ''}
        <div class="project-card-stats">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${formatDurationShort(totalMs)}
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${projectEntries.length} entries
          </span>
        </div>
        ${!isCompleted ? '<div class="project-card-actions">'
          + (isTimerActive
            ? '<button class="btn btn-danger btn-sm btn-full" onclick="stopTimer()"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>Stop</span></button>'
            : '<button class="btn btn-primary btn-sm btn-full" onclick="startTimer(\'' + project.id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Start</span></button>')
          + '</div>' : ''}
      </div>
    `;
  }).join('');
}


// ==================== CHART ====================

async function renderChart() {
  try {
    const chartData = await API.getChartData();
    const container = document.getElementById('chart-bars');
    const noData = document.getElementById('no-chart-data');

    if (chartData.length === 0) {
      container.style.display = 'none';
      noData.style.display = '';
      return;
    }

    container.style.display = '';
    noData.style.display = 'none';

    const maxTime = Math.max(...chartData.map(d => d.totalTime));

    container.innerHTML = chartData.map((item, i) => {
      const pct = maxTime > 0 ? (item.totalTime / maxTime) * 100 : 0;
      const timeStr = formatDurationShort(item.totalTime);
      return `
        <div class="chart-row">
          <div class="chart-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="chart-bar-wrapper">
            <div class="chart-bar" style="width: 0%; background: ${item.color};" data-width="${pct}%">
              ${pct > 20 ? `<span class="chart-bar-text">${timeStr}</span>` : ''}
            </div>
          </div>
          <div class="chart-time">${timeStr}</div>
        </div>
      `;
    }).join('');

    // Animate bars after render
    requestAnimationFrame(() => {
      container.querySelectorAll('.chart-bar').forEach(bar => {
        bar.style.width = bar.dataset.width;
      });
    });
  } catch (err) {
    console.error('Failed to load chart data:', err);
  }
}

// ==================== TAB SWITCHING ====================

function switchProjectTab(tab) {
  currentProjectTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderProjects();
}

async function renderRecentEntries() {
  try {
    cachedEntries = await API.getEntries();
  } catch (err) {
    console.error('Failed to load entries:', err);
    return;
  }

  const container = document.getElementById('recent-entries');
  const noEntries = document.getElementById('no-entries');

  if (cachedEntries.length === 0) {
    container.style.display = 'none';
    noEntries.style.display = '';
    return;
  }

  container.style.display = '';
  noEntries.style.display = 'none';

  container.innerHTML = cachedEntries.slice(0, 15).map(entry => {
    const project = cachedProjects.find(p => p.id === entry.project_id);
    const color = project ? project.color : '#6366f1';
    const projectName = project ? escapeHtml(project.name) : '(Deleted Project)';

    return `
      <div class="entry-item" id="entry-${entry.id}">
        <div class="entry-color" style="background: ${color};"></div>
        <div class="entry-details">
          <div class="entry-project">${projectName}</div>
          ${entry.note ? `<div class="entry-note">${escapeHtml(entry.note)}</div>` : ''}
        </div>
        <div class="entry-meta">
          <div class="entry-duration">${formatDuration(entry.duration)}</div>
          <div class="entry-date">${formatDate(entry.end_time)} ${formatTime(entry.start_time)}</div>
        </div>
        <button class="entry-delete-btn" onclick="deleteEntry('${entry.id}')" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  }).join('');
}


// ==================== TIMER ====================
// Timer state is kept in localStorage since it's ephemeral UI state.
// The actual time entry is saved to SQLite when the timer is stopped.

function getActiveTimer() {
  return JSON.parse(localStorage.getItem('tf_active_timer') || 'null');
}

function setActiveTimer(timer) {
  localStorage.setItem('tf_active_timer', JSON.stringify(timer));
}

function clearActiveTimer() {
  localStorage.removeItem('tf_active_timer');
}

function startTimer(projectId) {
  const activeTimer = getActiveTimer();
  if (activeTimer) {
    showToast('A timer is already running. Stop it first.', 'error');
    return;
  }

  const project = cachedProjects.find(p => p.id === projectId);
  if (!project) return;

  const timer = {
    projectId,
    startTime: new Date().toISOString()
  };

  setActiveTimer(timer);
  resumeTimer(timer);
  renderProjects();
  showToast(`Timer started for "${project.name}"!`, 'success');
}

function resumeTimer(timer) {
  const project = cachedProjects.find(p => p.id === timer.projectId);
  if (!project) {
    clearActiveTimer();
    return;
  }

  const banner = document.getElementById('active-timer-banner');
  const projectName = document.getElementById('timer-project-name');
  const display = document.getElementById('timer-display');

  projectName.textContent = project.name;
  banner.style.display = '';

  if (timerInterval) clearInterval(timerInterval);

  function updateDisplay() {
    const elapsed = Date.now() - new Date(timer.startTime).getTime();
    display.textContent = formatDuration(elapsed);
  }

  updateDisplay();
  timerInterval = setInterval(updateDisplay, 1000);
}

function stopTimer() {
  const activeTimer = getActiveTimer();
  if (!activeTimer) return;

  const elapsed = Date.now() - new Date(activeTimer.startTime).getTime();
  const project = cachedProjects.find(p => p.id === activeTimer.projectId);

  pendingTimerStop = {
    ...activeTimer,
    endTime: new Date().toISOString(),
    duration: elapsed
  };

  document.getElementById('timer-summary-project').textContent = project ? project.name : 'Project';
  document.getElementById('timer-summary-duration').textContent = formatDuration(elapsed);
  document.getElementById('timer-note').value = '';
  document.getElementById('timer-note-modal').style.display = '';
}

function cancelStopTimer() {
  pendingTimerStop = null;
  closeModal('timer-note-modal');
}

async function handleSaveTimeEntry(e) {
  e.preventDefault();
  if (!pendingTimerStop) return;

  const note = document.getElementById('timer-note').value.trim();

  try {
    await API.createEntry(
      pendingTimerStop.projectId,
      pendingTimerStop.startTime,
      pendingTimerStop.endTime,
      pendingTimerStop.duration,
      note
    );

    // Clear timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    clearActiveTimer();
    document.getElementById('active-timer-banner').style.display = 'none';

    pendingTimerStop = null;
    closeModal('timer-note-modal');

    await renderDashboard();
    showToast('Time entry saved!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ==================== PROJECTS ====================

let selectedColor = '#6366f1';

function selectColor(btn) {
  document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedColor = btn.dataset.color;
}

function openNewProjectModal() {
  document.getElementById('project-name').value = '';
  document.getElementById('project-description').value = '';
  document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
  document.querySelector('.color-option[data-color="#6366f1"]').classList.add('selected');
  selectedColor = '#6366f1';

  document.getElementById('new-project-modal').style.display = '';
}

async function handleCreateProject(e) {
  e.preventDefault();

  const name = document.getElementById('project-name').value.trim();
  const description = document.getElementById('project-description').value.trim();

  if (!name) {
    showToast('Please enter a project name.', 'error');
    return;
  }

  try {
    await API.createProject(name, description, selectedColor);
    closeModal('new-project-modal');
    await renderDashboard();
    showToast(`Project "${name}" created!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openDeleteProject(projectId) {
  deleteProjectId = projectId;
  document.getElementById('delete-modal').style.display = '';
}

async function confirmDeleteProject() {
  if (!deleteProjectId) return;

  // Clear timer if running for this project
  const activeTimer = getActiveTimer();
  if (activeTimer && activeTimer.projectId === deleteProjectId) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    clearActiveTimer();
    document.getElementById('active-timer-banner').style.display = 'none';
  }

  try {
    await API.deleteProject(deleteProjectId);
    deleteProjectId = null;
    closeModal('delete-modal');
    await renderDashboard();
    showToast('Project deleted.', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== COMPLETE PROJECT ====================

function openCompleteProject(projectId) {
  completeProjectId = projectId;
  document.getElementById('complete-modal').style.display = '';
}

async function confirmCompleteProject() {
  if (!completeProjectId) return;

  // Clear timer if running for this project
  const activeTimer = getActiveTimer();
  if (activeTimer && activeTimer.projectId === completeProjectId) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    clearActiveTimer();
    document.getElementById('active-timer-banner').style.display = 'none';
  }

  try {
    await API.completeProject(completeProjectId);
    completeProjectId = null;
    closeModal('complete-modal');
    await renderDashboard();
    showToast('Project completed! 🎉', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reopenProject(projectId) {
  try {
    await API.reopenProject(projectId);
    await renderDashboard();
    showToast('Project reopened.', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ==================== ENTRIES ====================

async function deleteEntry(entryId) {
  try {
    await API.deleteEntry(entryId);
    await renderDashboard();
    showToast('Entry deleted.', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ==================== MODAL HELPERS ====================

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
    if (e.target.id === 'timer-note-modal') {
      pendingTimerStop = null;
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      if (m.style.display !== 'none') {
        m.style.display = 'none';
        if (m.id === 'timer-note-modal') {
          pendingTimerStop = null;
        }
      }
    });
  }
});


// ==================== INITIALIZATION ====================

async function init() {
  const token = API.getToken();
  if (token) {
    try {
      const data = await API.getMe();
      currentUser = data.user;
      await enterDashboard();
    } catch (err) {
      // Token is invalid or expired
      API.clearToken();
      showView('auth-view');
    }
  } else {
    showView('auth-view');
  }
}

init();
