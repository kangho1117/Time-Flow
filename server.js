/* ============================================
   TimeFlow — Express + SQLite Backend Server
   ============================================ */

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 8080;

// ==================== DATABASE SETUP ====================

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration INTEGER NOT NULL,
    note TEXT DEFAULT '',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ==================== MIDDLEWARE ====================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateId() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session.' });

  const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found.' });

  req.user = user;
  next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists.' });
    }

    const id = generateId();
    const passwordHash = bcrypt.hashSync(password, 10);

    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, email, passwordHash, new Date().toISOString());

    res.json({ message: 'Account created successfully.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'
    ).run(token, user.id, new Date().toISOString());

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ message: 'Logged out.' });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ==================== PROJECT ROUTES ====================

app.get('/api/projects', authenticate, (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM projects WHERE user_id = ?';
  const params = [req.user.id];

  if (status === 'active' || status === 'completed') {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';
  const projects = db.prepare(query).all(...params);
  res.json(projects);
});

app.post('/api/projects', authenticate, (req, res) => {
  try {
    const { name, description, color } = req.body;

    if (!name) return res.status(400).json({ error: 'Project name is required.' });

    const existing = db.prepare(
      'SELECT id FROM projects WHERE user_id = ? AND name = ?'
    ).get(req.user.id, name);
    if (existing) {
      return res.status(409).json({ error: 'A project with this name already exists.' });
    }

    const id = generateId();
    const createdAt = new Date().toISOString();

    db.prepare(
      'INSERT INTO projects (id, user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, req.user.id, name, description || '', color || '#6366f1', createdAt);

    res.json({ id, user_id: req.user.id, name, description: description || '', color: color || '#6366f1', status: 'active', created_at: createdAt, completed_at: null });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.delete('/api/projects/:id', authenticate, (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  db.prepare('DELETE FROM entries WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

  res.json({ message: 'Project deleted.' });
});

app.patch('/api/projects/:id/complete', authenticate, (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const completedAt = new Date().toISOString();
  db.prepare(
    'UPDATE projects SET status = ?, completed_at = ? WHERE id = ?'
  ).run('completed', completedAt, req.params.id);

  res.json({ message: 'Project completed.', completed_at: completedAt });
});

app.patch('/api/projects/:id/reopen', authenticate, (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  db.prepare(
    'UPDATE projects SET status = ?, completed_at = NULL WHERE id = ?'
  ).run('active', req.params.id);

  res.json({ message: 'Project reopened.' });
});

// ==================== ENTRY ROUTES ====================

app.get('/api/entries', authenticate, (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM entries WHERE user_id = ? ORDER BY end_time DESC LIMIT 50'
  ).all(req.user.id);
  res.json(entries);
});

app.post('/api/entries', authenticate, (req, res) => {
  try {
    const { projectId, startTime, endTime, duration, note } = req.body;

    if (!projectId || !startTime || !endTime || duration == null) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const id = generateId();

    db.prepare(
      'INSERT INTO entries (id, project_id, user_id, start_time, end_time, duration, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, req.user.id, startTime, endTime, duration, note || '');

    res.json({ id });
  } catch (err) {
    console.error('Create entry error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.delete('/api/entries/:id', authenticate, (req, res) => {
  const entry = db.prepare(
    'SELECT * FROM entries WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });

  db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  res.json({ message: 'Entry deleted.' });
});

// ==================== STATS ROUTE ====================

app.get('/api/stats', authenticate, (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek.toISOString();

  const todayTime = db.prepare(
    'SELECT COALESCE(SUM(duration), 0) as total FROM entries WHERE user_id = ? AND end_time >= ?'
  ).get(req.user.id, todayStart);

  const weekTime = db.prepare(
    'SELECT COALESCE(SUM(duration), 0) as total FROM entries WHERE user_id = ? AND end_time >= ?'
  ).get(req.user.id, weekStart);

  const projectCount = db.prepare(
    "SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND status = 'active'"
  ).get(req.user.id);

  const completedCount = db.prepare(
    "SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND status = 'completed'"
  ).get(req.user.id);

  const entryCount = db.prepare(
    'SELECT COUNT(*) as count FROM entries WHERE user_id = ?'
  ).get(req.user.id);

  res.json({
    todayTime: todayTime.total,
    weekTime: weekTime.total,
    projectCount: projectCount.count,
    completedCount: completedCount.count,
    entryCount: entryCount.count
  });
});

// ==================== CHART DATA ROUTE ====================

app.get('/api/chart-data', authenticate, (req, res) => {
  const projects = db.prepare(
    'SELECT id, name, color, status FROM projects WHERE user_id = ?'
  ).all(req.user.id);

  const chartData = projects.map(p => {
    const result = db.prepare(
      'SELECT COALESCE(SUM(duration), 0) as total FROM entries WHERE project_id = ? AND user_id = ?'
    ).get(p.id, req.user.id);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      totalTime: result.total
    };
  }).filter(p => p.totalTime > 0)
    .sort((a, b) => b.totalTime - a.totalTime);

  res.json(chartData);
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log('');
  console.log('  ⏱  TimeFlow server is running!');
  console.log(`  → http://localhost:${PORT}`);
  console.log('');
});
