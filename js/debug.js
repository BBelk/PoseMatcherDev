const DEBUG_STORAGE_KEY = 'pmDebugLogs';
const MAX_SESSIONS = 5;
const MAX_LOGS_PER_SESSION = 200;

let currentSession = null;
let sessionStartTime = 0;

function getStoredSessions() {
  try {
    const raw = localStorage.getItem(DEBUG_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    // localStorage full - trim oldest session and retry
    if (sessions.length > 1) {
      sessions.shift();
      saveSessions(sessions);
    }
  }
}

function startSession() {
  sessionStartTime = performance.now();
  const sessions = getStoredSessions();

  // Mark any previous session that didn't end cleanly as crashed
  for (const s of sessions) {
    if (s.status === 'running') {
      s.status = 'crashed';
    }
  }

  currentSession = {
    id: Date.now(),
    start: new Date().toISOString(),
    userAgent: navigator.userAgent,
    status: 'running',
    logs: []
  };

  sessions.push(currentSession);

  // Keep only last N sessions
  while (sessions.length > MAX_SESSIONS) {
    sessions.shift();
  }

  saveSessions(sessions);

  dlog('info', 'Session started', {
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    platform: navigator.platform
  });
}

function persistCurrentSession() {
  if (!currentSession) return;
  const sessions = getStoredSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);
  if (idx >= 0) {
    sessions[idx] = currentSession;
  } else {
    sessions.push(currentSession);
  }
  saveSessions(sessions);
}

export function dlog(level, message, data = null) {
  if (!currentSession) return;

  const entry = {
    t: Math.round(performance.now() - sessionStartTime),
    level,
    msg: message
  };
  if (data !== null && data !== undefined) {
    entry.data = data;
  }

  currentSession.logs.push(entry);

  // Trim if too many logs
  if (currentSession.logs.length > MAX_LOGS_PER_SESSION) {
    currentSession.logs = currentSession.logs.slice(-MAX_LOGS_PER_SESSION);
  }

  // Persist immediately so we don't lose logs on crash
  persistCurrentSession();

  // Also log to console for normal debugging
  const consoleMsg = data ? `[${level}] ${message}` : `[${level}] ${message}`;
  if (level === 'error') {
    console.error(consoleMsg, data || '');
  } else if (level === 'warn') {
    console.warn(consoleMsg, data || '');
  } else {
    console.log(consoleMsg, data || '');
  }
}

export function dlogError(message, error) {
  dlog('error', message, {
    message: error?.message || String(error),
    stack: error?.stack?.split('\n').slice(0, 5).join('\n')
  });
}

export function endSession() {
  if (!currentSession) return;
  dlog('info', 'Session ended normally');
  currentSession.status = 'ended';
  persistCurrentSession();
}

export function getDebugSessions() {
  return getStoredSessions();
}

export function clearDebugLogs() {
  localStorage.removeItem(DEBUG_STORAGE_KEY);
  if (currentSession) {
    currentSession.logs = [];
    startSession();
  }
}

export function formatLogsForCopy() {
  const sessions = getStoredSessions();
  let output = '';

  for (const session of sessions) {
    const statusIcon = session.status === 'crashed' ? '💥 CRASHED' :
                       session.status === 'running' ? '🔄 RUNNING' : '✓ ENDED';
    output += `\n=== Session ${session.start} [${statusIcon}] ===\n`;
    output += `UA: ${session.userAgent}\n\n`;

    for (const log of session.logs) {
      const time = (log.t / 1000).toFixed(2) + 's';
      const dataStr = log.data ? ' ' + JSON.stringify(log.data) : '';
      output += `[${time}] ${log.level.toUpperCase()}: ${log.msg}${dataStr}\n`;
    }
  }

  return output.trim();
}

// Initialize on load
startSession();

// Mark session as ended on clean unload
window.addEventListener('pagehide', endSession);
window.addEventListener('beforeunload', endSession);
