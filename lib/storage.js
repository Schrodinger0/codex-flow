#!/usr/bin/env node
/**
 * To-Do App SQLite Storage Module
 * Handles persistence of tasks using SQLite database
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDataDir, validateTask, generateId } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');
const DATA_DIR = path.dirname(DB_PATH);

let db = null;

/**
 * Initialize the database connection
 * @returns {Database} SQLite database instance
 */
function getDatabase() {
  if (!db) {
    ensureDataDir(DATA_DIR);
    db = new Database(DB_PATH);
    initializeTables();
  }
  return db;
}

/**
 * Initialize database tables
 */
function initializeTables() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createIndexSQL = `
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
  `;
  
  db.exec(createTableSQL);
  db.exec(createIndexSQL);
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create a new task
 * @param {string} description - Task description
 * @returns {Promise<Object>} Created task
 */
export async function createTask(description) {
  const task = {
    id: generateId(),
    description: description.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  
  const validation = validateTask(task);
  if (!validation.isValid) {
    throw new Error(`Invalid task: ${validation.errors.join(', ')}`);
  }
  
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO tasks (id, description, status, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  try {
    stmt.run(task.id, task.description, task.status, task.createdAt, task.completedAt);
    return task;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Task with ID "${task.id}" already exists`);
    }
    throw new Error(`Failed to create task: ${error.message}`);
  }
}

/**
 * Get all tasks with optional filtering
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasks(options = {}) {
  const database = getDatabase();
  let sql = 'SELECT * FROM tasks';
  const params = [];
  
  // Add WHERE clause for filtering
  if (options.status) {
    sql += ' WHERE status = ?';
    params.push(options.status);
  }
  
  if (options.since) {
    const whereClause = options.status ? ' AND created_at >= ?' : ' WHERE created_at >= ?';
    sql += whereClause;
    params.push(options.since);
  }
  
  // Add ORDER BY clause
  const sortBy = options.sortBy || 'created_at';
  const sortOrder = options.sortOrder || 'DESC';
  
  // Map camelCase to snake_case for database columns
  const columnMap = {
    'createdAt': 'created_at',
    'description': 'description',
    'status': 'status'
  };
  
  const dbColumn = columnMap[sortBy] || sortBy;
  sql += ` ORDER BY ${dbColumn} ${sortOrder}`;
  
  try {
    const rows = database.prepare(sql).all(...params);
    return rows.map(row => ({
      id: row.id,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }));
  } catch (error) {
    throw new Error(`Failed to retrieve tasks: ${error.message}`);
  }
}

/**
 * Find task by ID
 * @param {string} id - Task ID
 * @returns {Promise<Object|null>} Task object or null
 */
export async function findTaskById(id) {
  const database = getDatabase();
  const stmt = database.prepare('SELECT * FROM tasks WHERE id = ?');
  
  try {
    const row = stmt.get(id);
    if (!row) return null;
    
    return {
      id: row.id,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  } catch (error) {
    throw new Error(`Failed to find task: ${error.message}`);
  }
}

/**
 * Find tasks by description (partial match)
 * @param {string} description - Description to search for
 * @returns {Promise<Array>} Array of matching tasks
 */
export async function findTasksByDescription(description) {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT * FROM tasks 
    WHERE description LIKE ? 
    ORDER BY created_at DESC
  `);
  
  try {
    const rows = stmt.all(`%${description}%`);
    return rows.map(row => ({
      id: row.id,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }));
  } catch (error) {
    throw new Error(`Failed to search tasks: ${error.message}`);
  }
}

/**
 * Update a task
 * @param {string} id - Task ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated task
 */
export async function updateTask(id, updates) {
  const database = getDatabase();
  
  // Check if task exists
  const existingTask = await findTaskById(id);
  if (!existingTask) {
    throw new Error(`Task with ID "${id}" not found`);
  }
  
  // Prepare update data
  const updateData = { ...existingTask, ...updates };
  updateData.updatedAt = new Date().toISOString();
  
  // Set completion timestamp if marking as completed
  if (updates.status === 'completed' && !updateData.completedAt) {
    updateData.completedAt = new Date().toISOString();
  }
  
  // Clear completion timestamp if marking as pending
  if (updates.status === 'pending') {
    updateData.completedAt = null;
  }
  
  const validation = validateTask(updateData);
  if (!validation.isValid) {
    throw new Error(`Invalid task update: ${validation.errors.join(', ')}`);
  }
  
  const stmt = database.prepare(`
    UPDATE tasks 
    SET description = ?, status = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `);
  
  try {
    const result = stmt.run(
      updateData.description,
      updateData.status,
      updateData.completedAt,
      updateData.updatedAt,
      id
    );
    
    if (result.changes === 0) {
      throw new Error(`Task with ID "${id}" not found`);
    }
    
    return updateData;
  } catch (error) {
    throw new Error(`Failed to update task: ${error.message}`);
  }
}

/**
 * Delete a task
 * @param {string} id - Task ID
 * @returns {Promise<Object>} Deleted task
 */
export async function deleteTask(id) {
  const database = getDatabase();
  
  // Get task before deletion
  const task = await findTaskById(id);
  if (!task) {
    throw new Error(`Task with ID "${id}" not found`);
  }
  
  const stmt = database.prepare('DELETE FROM tasks WHERE id = ?');
  
  try {
    const result = stmt.run(id);
    if (result.changes === 0) {
      throw new Error(`Task with ID "${id}" not found`);
    }
    
    return task;
  } catch (error) {
    throw new Error(`Failed to delete task: ${error.message}`);
  }
}

/**
 * Clear all tasks
 * @returns {Promise<number>} Number of tasks deleted
 */
export async function clearAllTasks() {
  const database = getDatabase();
  const stmt = database.prepare('DELETE FROM tasks');
  
  try {
    const result = stmt.run();
    return result.changes;
  } catch (error) {
    throw new Error(`Failed to clear tasks: ${error.message}`);
  }
}

/**
 * Get task statistics
 * @returns {Promise<Object>} Task statistics
 */
export async function getTaskStatistics() {
  const database = getDatabase();
  
  try {
    const totalStmt = database.prepare('SELECT COUNT(*) as count FROM tasks');
    const completedStmt = database.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = ?');
    const pendingStmt = database.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = ?');
    
    const total = totalStmt.get().count;
    const completed = completedStmt.get('completed').count;
    const pending = pendingStmt.get('pending').count;
    
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return {
      total,
      completed,
      pending,
      completionRate
    };
  } catch (error) {
    throw new Error(`Failed to get statistics: ${error.message}`);
  }
}

/**
 * Initialize database for testing
 * @param {string} testDbPath - Path to test database
 */
export function initializeTestDatabase(testDbPath) {
  if (db) {
    db.close();
  }
  
  ensureDataDir(path.dirname(testDbPath));
  db = new Database(testDbPath);
  initializeTables();
}

/**
 * Cleanup test database
 */
export function cleanupTestDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
