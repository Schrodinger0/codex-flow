#!/usr/bin/env node
/**
 * To-Do App Storage Module
 * Handles persistence of tasks using JSON file storage
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_FILE = path.join(__dirname, '..', 'data', 'todos.json');
const DATA_DIR = path.dirname(STORAGE_FILE);

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * Load tasks from storage
 * @returns {Promise<Array>} Array of tasks
 */
export async function loadTasks() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return empty array
      return [];
    }
    throw new Error(`Failed to load tasks: ${error.message}`);
  }
}

/**
 * Save tasks to storage
 * @param {Array} tasks - Array of tasks to save
 * @returns {Promise<void>}
 */
export async function saveTasks(tasks) {
  try {
    await ensureDataDir();
    const data = JSON.stringify(tasks, null, 2);
    await fs.writeFile(STORAGE_FILE, data, 'utf8');
  } catch (error) {
    throw new Error(`Failed to save tasks: ${error.message}`);
  }
}

/**
 * Generate a unique task ID
 * @param {Array} tasks - Existing tasks
 * @returns {string} Unique ID
 */
export function generateTaskId(tasks) {
  const maxId = tasks.reduce((max, task) => {
    const id = parseInt(task.id) || 0;
    return Math.max(max, id);
  }, 0);
  return (maxId + 1).toString();
}

/**
 * Find task by ID
 * @param {Array} tasks - Array of tasks
 * @param {string} id - Task ID
 * @returns {Object|null} Task object or null
 */
export function findTaskById(tasks, id) {
  return tasks.find(task => task.id === id) || null;
}

/**
 * Find tasks by description (partial match)
 * @param {Array} tasks - Array of tasks
 * @param {string} description - Description to search for
 * @returns {Array} Array of matching tasks
 */
export function findTasksByDescription(tasks, description) {
  const searchTerm = description.toLowerCase().trim();
  return tasks.filter(task => 
    task.description.toLowerCase().includes(searchTerm)
  );
}

/**
 * Validate task object
 * @param {Object} task - Task object to validate
 * @returns {Object} Validation result
 */
export function validateTask(task) {
  const errors = [];
  
  if (!task.description || typeof task.description !== 'string') {
    errors.push('Description is required and must be a string');
  }
  
  if (task.description && task.description.trim().length === 0) {
    errors.push('Description cannot be empty');
  }
  
  if (task.status && !['pending', 'completed'].includes(task.status)) {
    errors.push('Status must be either "pending" or "completed"');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Create a new task
 * @param {string} description - Task description
 * @returns {Promise<Object>} Created task
 */
export async function createTask(description) {
  const tasks = await loadTasks();
  const id = generateTaskId(tasks);
  
  const task = {
    id,
    description: description.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  
  const validation = validateTask(task);
  if (!validation.isValid) {
    throw new Error(`Invalid task: ${validation.errors.join(', ')}`);
  }
  
  tasks.push(task);
  await saveTasks(tasks);
  
  return task;
}

/**
 * Update a task
 * @param {string} id - Task ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated task
 */
export async function updateTask(id, updates) {
  const tasks = await loadTasks();
  const taskIndex = tasks.findIndex(task => task.id === id);
  
  if (taskIndex === -1) {
    throw new Error(`Task with ID "${id}" not found`);
  }
  
  const updatedTask = { ...tasks[taskIndex], ...updates };
  
  // Set completion timestamp if marking as completed
  if (updates.status === 'completed' && !updatedTask.completedAt) {
    updatedTask.completedAt = new Date().toISOString();
  }
  
  // Clear completion timestamp if marking as pending
  if (updates.status === 'pending') {
    updatedTask.completedAt = null;
  }
  
  const validation = validateTask(updatedTask);
  if (!validation.isValid) {
    throw new Error(`Invalid task update: ${validation.errors.join(', ')}`);
  }
  
  tasks[taskIndex] = updatedTask;
  await saveTasks(tasks);
  
  return updatedTask;
}

/**
 * Delete a task
 * @param {string} id - Task ID
 * @returns {Promise<Object>} Deleted task
 */
export async function deleteTask(id) {
  const tasks = await loadTasks();
  const taskIndex = tasks.findIndex(task => task.id === id);
  
  if (taskIndex === -1) {
    throw new Error(`Task with ID "${id}" not found`);
  }
  
  const deletedTask = tasks[taskIndex];
  tasks.splice(taskIndex, 1);
  await saveTasks(tasks);
  
  return deletedTask;
}

/**
 * Get tasks with optional filtering
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Filtered tasks
 */
export async function getTasks(options = {}) {
  let tasks = await loadTasks();
  
  // Filter by status
  if (options.status) {
    tasks = tasks.filter(task => task.status === options.status);
  }
  
  // Filter by date range
  if (options.since) {
    const sinceDate = new Date(options.since);
    tasks = tasks.filter(task => new Date(task.createdAt) >= sinceDate);
  }
  
  // Sort tasks
  const sortBy = options.sortBy || 'createdAt';
  const sortOrder = options.sortOrder || 'desc';
  
  tasks.sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
  
  return tasks;
}
