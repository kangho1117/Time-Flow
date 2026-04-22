# ⏱ TimeFlow — Project Time Tracker

A local web-based time tracking application with user authentication, project management, and time logging.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)

## Setup & Run

```bash
# 1. Clone the repository
git clone https://github.com/kangho1117/Time-Flow.git

# 2. Move into the project folder
cd Time-Flow

# 3. Install dependencies
npm install

# 4. Start the server
node server.js
```

Open your browser and go to **http://localhost:8080**

## Features

- **User Authentication** — Register and login with bcrypt-hashed passwords
- **Project Management** — Create, complete, reopen, and delete projects
- **Time Tracking** — Start/stop timer with notes per entry
- **Time Distribution Chart** — Visual bar chart of time spent per project
- **SQLite Database** — All data is stored locally in `data.db`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML, CSS, Vanilla JS |
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| Auth | bcryptjs + token sessions |
