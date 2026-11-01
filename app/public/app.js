// Claude Dev Studio Client
let activeProject = null;
let activeTaskId = null;
let currentEventSource = null;

// DOM Elements
const projectSelect = document.getElementById('projectSelect');
const gitBranchText = document.getElementById('gitBranchText');
const gitChangesBadge = document.getElementById('gitChangesBadge');
const gitFilesCount = document.getElementById('gitFilesCount');
const changedFilesList = document.getElementById('changedFilesList');
const diffViewer = document.getElementById('diffViewer');
const tabDiffCounter = document.getElementById('tabDiffCounter');
const commitMessageInput = document.getElementById('commitMessageInput');
const btnAiCommit = document.getElementById('btnAiCommit');
const btnCommitAndPush = document.getElementById('btnCommitAndPush');
const pushLog = document.getElementById('pushLog');
const btnRefreshGit = document.getElementById('btnRefreshGit');

// Agent DOM Elements
const chatStream = document.getElementById('chatStream');
const promptInput = document.getElementById('promptInput');
const btnSend = document.getElementById('btnSend');
const btnStop = document.getElementById('btnStop');
const agentStatus = document.getElementById('agentStatus');
const btnClearChat = document.getElementById('btnClearChat');

// Terminal DOM Elements
const termInput = document.getElementById('termInput');
const btnRunTerm = document.getElementById('btnRunTerm');
const termOutput = document.getElementById('termOutput');

// Modal Elements
const cloneModal = document.getElementById('cloneModal');
const btnOpenCloneModal = document.getElementById('btnOpenCloneModal');
const btnOpenCloneModal2 = document.getElementById('btnOpenCloneModal2');
const btnCloseCloneModal = document.getElementById('btnCloseCloneModal');
const btnCancelClone = document.getElementById('btnCancelClone');
const btnDoClone = document.getElementById('btnDoClone');
const cloneRepoInput = document.getElementById('cloneRepoInput');
const cloneBranchInput = document.getElementById('cloneBranchInput');
const cloneStatusMsg = document.getElementById('cloneStatusMsg');
const projectsList = document.getElementById('projectsList');

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(tabId)?.classList.add('active');
  });
});

document.getElementById('btnQuickReview')?.addEventListener('click', () => {
  switchTab('tabGit');
});

document.getElementById('btnQuickCommit')?.addEventListener('click', () => {
  switchTab('tabGit');
  commitMessageInput?.focus();
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === tabId);
  });
}

// -----------------------------------------------------------------------------
// Projects & Git Management
// -----------------------------------------------------------------------------

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const projects = data.projects || [];

    projectSelect.innerHTML = '';

    if (projects.length === 0) {
      projectSelect.innerHTML = '<option value="" disabled selected>No repositories found</option>';
      renderProjectsTab([]);
      updateGitBadge(null);
      return;
    }

    projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} ${p.branch ? `(${p.branch})` : ''} ${p.isDirty ? '•' : ''}`;
      projectSelect.appendChild(opt);
    });

    // Select stored or first project
    const saved = localStorage.getItem('claude_active_project');
    const target = projects.find((p) => p.name === saved) ? saved : projects[0].name;
    projectSelect.value = target;
    activeProject = target;
    localStorage.setItem('claude_active_project', activeProject);

    renderProjectsTab(projects);
    await refreshProjectStatus();
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

function renderProjectsTab(projects) {
  if (!projectsList) return;
  if (projects.length === 0) {
    projectsList.innerHTML = `
      <div class="empty-state">
        No projects cloned yet.<br><br>
        <button id="btnCloneFromEmpty" class="btn btn-primary btn-sm">+ Clone your first repository</button>
      </div>`;
    document.getElementById('btnCloneFromEmpty')?.addEventListener('click', openCloneModal);
    return;
  }

  projectsList.innerHTML = projects.map((p) => `
    <div class="project-card ${p.name === activeProject ? 'active' : ''}" data-name="${escapeHtml(p.name)}">
      <div class="project-card-header">
        <span class="project-name">📁 ${escapeHtml(p.name)}</span>
        <span class="file-status-badge ${p.isDirty ? 'modified' : 'added'}">${p.isDirty ? 'Dirty' : 'Clean'}</span>
      </div>
      <div class="project-card-meta">
        <span>🌿 ${escapeHtml(p.branch || 'main')}</span>
        ${p.changesCount > 0 ? `<span>✏️ ${p.changesCount} changes</span>` : ''}
        ${p.lastCommit ? `<span>🕒 ${escapeHtml(p.lastCommit.time || '')}</span>` : ''}
      </div>
    </div>
  `).join('');

  projectsList.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const name = card.getAttribute('data-name');
      projectSelect.value = name;
      activeProject = name;
      localStorage.setItem('claude_active_project', activeProject);
      await refreshProjectStatus();
      renderProjectsTab(projects);
    });
  });
}

projectSelect.addEventListener('change', async () => {
  activeProject = projectSelect.value;
  localStorage.setItem('claude_active_project', activeProject);
  await refreshProjectStatus();
});

async function refreshProjectStatus() {
  if (!activeProject) {
    updateGitBadge(null);
    return;
  }

  try {
    const res = await fetch(`/api/projects/status?project=${encodeURIComponent(activeProject)}`);
    const status = await res.json();

    updateGitBadge(status);
    renderChangedFiles(status.changedFiles || []);
    await refreshDiff();
  } catch (err) {
    console.error('Failed to fetch project status:', err);
  }
}

function updateGitBadge(status) {
  if (!status || !status.branch) {
    gitBranchText.textContent = 'no repo';
    gitChangesBadge.classList.add('hidden');
    tabDiffCounter.classList.add('hidden');
    return;
  }

  gitBranchText.textContent = status.branch;
  const count = (status.changedFiles || []).length;
  gitFilesCount.textContent = `${count} file${count === 1 ? '' : 's'} changed`;

  if (count > 0) {
    gitChangesBadge.textContent = count;
    gitChangesBadge.classList.remove('hidden');
    tabDiffCounter.textContent = count;
    tabDiffCounter.classList.remove('hidden');
  } else {
    gitChangesBadge.classList.add('hidden');
    tabDiffCounter.classList.add('hidden');
  }
}

function renderChangedFiles(files) {
  if (!files || files.length === 0) {
    changedFilesList.innerHTML = '<div class="empty-state">No uncommitted changes in this repository.</div>';
    return;
  }

  changedFilesList.innerHTML = files.map((f) => `
    <div class="changed-file-item">
      <span>${escapeHtml(f.path)}</span>
      <span class="file-status-badge ${f.status}">${f.status}</span>
    </div>
  `).join('');
}

async function refreshDiff() {
  if (!activeProject) {
    diffViewer.innerHTML = '<code>No active project</code>';
    return;
  }

  try {
    const res = await fetch(`/api/projects/diff?project=${encodeURIComponent(activeProject)}`);
    const data = await res.json();

    if (!data.hasChanges || !data.diff) {
      diffViewer.innerHTML = '<code>(clean working tree: no changes)</code>';
      return;
    }

    diffViewer.innerHTML = formatDiff(data.diff);
  } catch (err) {
    diffViewer.innerHTML = `<code>Error loading diff: ${escapeHtml(err.message)}</code>`;
  }
}

function formatDiff(rawDiff) {
  const lines = rawDiff.split('\n');
  const formatted = lines.map((line) => {
    const escaped = escapeHtml(line);
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="diff-add">${escaped}</span>`;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="diff-del">${escaped}</span>`;
    }
    if (line.startsWith('@@')) {
      return `<span class="diff-hunk">${escaped}</span>`;
    }
    return escaped;
  }).join('\n');
  return `<code>${formatted}</code>`;
}

btnRefreshGit?.addEventListener('click', async () => {
  await refreshProjectStatus();
});

// Commit & Push
btnCommitAndPush?.addEventListener('click', async () => {
  const message = commitMessageInput.value.trim();
  if (!message) {
    alert('Please enter a commit message.');
    commitMessageInput.focus();
    return;
  }
  if (!activeProject) {
    alert('Please select an active project first.');
    return;
  }

  btnCommitAndPush.disabled = true;
  btnCommitAndPush.textContent = '🚀 Committing & Pushing...';
  pushLog.classList.remove('hidden');
  pushLog.textContent = 'Pushing commits to GitHub...';

  try {
    const res = await fetch('/api/projects/commit-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: activeProject,
        message,
      }),
    });
    const result = await res.json();

    if (result.success) {
      pushLog.textContent = `✓ Successfully committed and pushed!\nCommit: ${result.commitHash}\nBranch: ${result.branch}\n\n${result.output || ''}`;
      commitMessageInput.value = '';
      await refreshProjectStatus();
    } else {
      pushLog.textContent = `✗ Push failed:\n${result.error || 'Unknown error'}\n${result.output || ''}`;
    }
  } catch (err) {
    pushLog.textContent = `✗ Request failed: ${err.message}`;
  } finally {
    btnCommitAndPush.disabled = false;
    btnCommitAndPush.textContent = '🚀 Commit & Push to GitHub';
  }
});

// AI Commit Message
btnAiCommit?.addEventListener('click', async () => {
  if (!activeProject) return;
  btnAiCommit.disabled = true;
  btnAiCommit.textContent = '✨ Thinking...';

  try {
    const res = await fetch('/api/projects/ai-commit-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: activeProject }),
    });
    const data = await res.json();
    if (data.commitMessage) {
      commitMessageInput.value = data.commitMessage;
    } else {
      alert(data.error || 'Could not generate commit message');
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btnAiCommit.disabled = false;
    btnAiCommit.textContent = '✨ AI Generate';
  }
});

// -----------------------------------------------------------------------------
// Clone Modal
// -----------------------------------------------------------------------------

function openCloneModal() {
  cloneModal.classList.remove('hidden');
  cloneRepoInput.value = '';
  cloneBranchInput.value = '';
  cloneStatusMsg.classList.add('hidden');
  cloneRepoInput.focus();
}

function closeCloneModal() {
  cloneModal.classList.add('hidden');
}

btnOpenCloneModal?.addEventListener('click', openCloneModal);
btnOpenCloneModal2?.addEventListener('click', openCloneModal);
btnCloseCloneModal?.addEventListener('click', closeCloneModal);
btnCancelClone?.addEventListener('click', closeCloneModal);

btnDoClone?.addEventListener('click', async () => {
  const repo = cloneRepoInput.value.trim();
  const branch = cloneBranchInput.value.trim();
  if (!repo) {
    alert('Please enter a GitHub repository (e.g. owner/repo).');
    return;
  }

  btnDoClone.disabled = true;
  btnDoClone.textContent = 'Cloning...';
  cloneStatusMsg.classList.remove('hidden', 'error', 'success');
  cloneStatusMsg.textContent = 'Cloning repository in background...';

  try {
    const res = await fetch('/api/projects/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, branch }),
    });
    const data = await res.json();

    if (data.success) {
      cloneStatusMsg.classList.add('success');
      cloneStatusMsg.textContent = `✓ Cloned ${data.name} successfully!`;
      await loadProjects();
      setTimeout(closeCloneModal, 1200);
    } else {
      cloneStatusMsg.classList.add('error');
      cloneStatusMsg.textContent = `✗ ${data.error || 'Clone failed'}`;
    }
  } catch (err) {
    cloneStatusMsg.classList.add('error');
    cloneStatusMsg.textContent = `✗ ${err.message}`;
  } finally {
    btnDoClone.disabled = false;
    btnDoClone.textContent = 'Start Clone';
  }
});

// -----------------------------------------------------------------------------
// Claude Agent Execution & SSE Stream
// -----------------------------------------------------------------------------

btnClearChat?.addEventListener('click', () => {
  chatStream.innerHTML = '';
});

// Chips
document.querySelectorAll('.chip[data-prompt]').forEach((chip) => {
  chip.addEventListener('click', () => {
    promptInput.value = chip.getAttribute('data-prompt');
    promptInput.focus();
  });
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runTask();
  }
});

btnSend?.addEventListener('click', runTask);
btnStop?.addEventListener('click', stopTask);

async function runTask() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  promptInput.value = '';
  activeTaskId = `task-${Date.now()}`;

  // Append user bubble
  appendUserMessage(prompt);

  // Set running state
  setAgentRunning(true);

  // Create assistant card
  const assistantBubble = createAssistantBubble();
  const contentEl = assistantBubble.querySelector('.message-text');

  let currentToolCard = null;

  try {
    const response = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        project: activeProject,
        taskId: activeTaskId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          handleAgentEvent(event, contentEl, assistantBubble);
        } catch (parseErr) {
          console.error('Failed to parse SSE event:', parseErr, jsonStr);
        }
      }
    }
  } catch (err) {
    console.error('Agent stream error:', err);
    contentEl.innerHTML += `\n<div class="form-status error">Error: ${escapeHtml(err.message)}</div>`;
  } finally {
    setAgentRunning(false);
    activeTaskId = null;
    await refreshProjectStatus();
  }
}

function handleAgentEvent(event, contentEl, bubble) {
  if (event.type === 'text') {
    contentEl.textContent += event.text;
    chatStream.scrollTop = chatStream.scrollHeight;
  } else if (event.type === 'tool_call') {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `tool-${event.id}`;
    card.innerHTML = `
      <div class="tool-header">
        <span class="tool-badge">🛠️ ${escapeHtml(event.name)}</span>
        <span class="tool-status">running...</span>
      </div>
      <div class="tool-body">${escapeHtml(JSON.stringify(event.input, null, 2))}</div>
    `;
    bubble.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  } else if (event.type === 'tool_result') {
    const card = document.getElementById(`tool-${event.id}`);
    if (card) {
      const statusEl = card.querySelector('.tool-status');
      if (statusEl) {
        statusEl.textContent = event.isError ? '✗ error' : '✓ done';
        statusEl.style.color = event.isError ? '#f85149' : '#3fb950';
      }
      const bodyEl = card.querySelector('.tool-body');
      if (bodyEl && event.content) {
        bodyEl.textContent = event.content;
      }
    }
  } else if (event.type === 'status') {
    agentStatus.textContent = event.description || event.status;
  } else if (event.type === 'complete') {
    agentStatus.textContent = 'Finished';
  } else if (event.type === 'aborted') {
    contentEl.innerHTML += '\n<em>[Task was cancelled by user]</em>';
  }
}

async function stopTask() {
  if (!activeTaskId) return;
  try {
    await fetch('/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: activeTaskId }),
    });
  } catch (err) {
    console.error('Failed to cancel task:', err);
  }
}

function setAgentRunning(running) {
  if (running) {
    agentStatus.className = 'agent-status-badge running';
    agentStatus.textContent = 'Agent Working...';
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    agentStatus.className = 'agent-status-badge idle';
    agentStatus.textContent = 'Ready';
    btnSend.classList.remove('hidden');
    btnStop.classList.add('hidden');
  }
}

function appendUserMessage(text) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble user';
  bubble.innerHTML = `<div class="message-text">${escapeHtml(text)}</div>`;
  chatStream.appendChild(bubble);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function createAssistantBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble assistant';
  bubble.innerHTML = `<div class="message-text"></div>`;
  chatStream.appendChild(bubble);
  chatStream.scrollTop = chatStream.scrollHeight;
  return bubble;
}

// -----------------------------------------------------------------------------
// Cloud Terminal
// -----------------------------------------------------------------------------

document.querySelectorAll('.chip[data-cmd]').forEach((chip) => {
  chip.addEventListener('click', () => {
    termInput.value = chip.getAttribute('data-cmd');
    termInput.focus();
  });
});

termInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runTerminalCmd();
  }
});

btnRunTerm?.addEventListener('click', runTerminalCmd);

async function runTerminalCmd() {
  const command = termInput.value.trim();
  if (!command) return;
  termInput.value = '';

  termOutput.textContent += `\n$ ${command}\n`;
  termOutput.scrollTop = termOutput.scrollHeight;

  try {
    const res = await fetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        project: activeProject,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const item = JSON.parse(jsonStr);
          if (item.data) termOutput.textContent += item.data;
          if (item.type === 'exit') termOutput.textContent += `\n[process exited with code ${item.code}]\n`;
          termOutput.scrollTop = termOutput.scrollHeight;
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    termOutput.textContent += `\nExecution error: ${err.message}\n`;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial load
window.addEventListener('DOMContentLoaded', () => {
  loadProjects();
});
