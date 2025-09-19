#!/usr/bin/env node
/**
 * To-Do App Utility Functions
 * Common utilities for error handling, validation, and CLI parsing
 */

import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Ensure directory exists
 * @param {string} dirPath - Directory path
 */
export function ensureDataDir(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
export function generateId() {
  return randomBytes(8).toString('hex');
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
  
  if (task.description && task.description.length > 500) {
    errors.push('Description cannot exceed 500 characters');
  }
  
  if (task.status && !['pending', 'completed'].includes(task.status)) {
    errors.push('Status must be either "pending" or "completed"');
  }
  
  if (task.id && typeof task.id !== 'string') {
    errors.push('ID must be a string');
  }
  
  if (task.id && task.id.length === 0) {
    errors.push('ID cannot be empty');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate task ID format
 * @param {string} id - Task ID to validate
 * @returns {boolean} True if valid
 */
export function isValidTaskId(id) {
  return typeof id === 'string' && id.length > 0 && /^[a-f0-9]+$/i.test(id);
}

/**
 * Sanitize string input
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 500); // Limit length
}

/**
 * Format error message for CLI
 * @param {Error} error - Error object
 * @returns {string} Formatted error message
 */
export function formatError(error) {
  if (error.message.includes('not found')) {
    return `❌ Task not found: ${error.message}`;
  }
  
  if (error.message.includes('Invalid task')) {
    return `❌ Invalid input: ${error.message}`;
  }
  
  if (error.message.includes('Failed to')) {
    return `❌ Operation failed: ${error.message}`;
  }
  
  return `❌ Error: ${error.message}`;
}

/**
 * Format success message for CLI
 * @param {string} operation - Operation performed
 * @param {Object} task - Task object
 * @returns {string} Formatted success message
 */
export function formatSuccess(operation, task) {
  const status = task.status === 'completed' ? '✅' : '⏳';
  const id = `[${task.id}]`;
  const description = task.description;
  
  if (operation === 'created') {
    return `✅ Task ${operation} successfully!\nTask: ${status} ${id} ${description} - Created on ${new Date(task.createdAt).toLocaleDateString()}`;
  }
  
  if (operation === 'completed') {
    const completedDate = new Date(task.completedAt).toLocaleDateString();
    return `✅ Task ${operation} successfully!\nTask: ${status} ${id} ${description} - Completed on ${completedDate}`;
  }
  
  if (operation === 'deleted') {
    return `✅ Task ${operation} successfully!\nDeleted: ${status} ${id} ${description}`;
  }
  
  return `✅ Task ${operation} successfully!`;
}

/**
 * Format task for display
 * @param {Object} task - Task object
 * @returns {string} Formatted task string
 */
export function formatTask(task) {
  const status = task.status === 'completed' ? '✅' : '⏳';
  const id = `[${task.id}]`;
  const description = task.description;
  const date = new Date(task.createdAt).toLocaleDateString();
  
  if (task.status === 'completed') {
    const completedDate = new Date(task.completedAt).toLocaleDateString();
    return `${status} ${id} ${description} - Completed on ${completedDate}`;
  } else {
    return `${status} ${id} ${description} - Created on ${date}`;
  }
}

/**
 * Parse command line arguments
 * @param {Array} args - Command line arguments
 * @returns {Object} Parsed arguments
 */
export function parseArgs(args) {
  const parsed = {
    command: null,
    description: null,
    id: null,
    query: null,
    options: {}
  };
  
  if (args.length === 0) {
    return parsed;
  }
  
  parsed.command = args[0];
  
  // Parse options and arguments
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const option = arg.substring(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        parsed.options[option] = args[i + 1];
        i++; // Skip next argument as it's the value
      } else {
        parsed.options[option] = true;
      }
    } else if (arg.startsWith('-')) {
      const option = arg.substring(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        parsed.options[option] = args[i + 1];
        i++; // Skip next argument as it's the value
      } else {
        parsed.options[option] = true;
      }
    } else {
      // This is a positional argument
      if (!parsed.description && (parsed.command === 'add' || parsed.command === 'search')) {
        parsed.description = arg;
      } else if (!parsed.id && (parsed.command === 'complete' || parsed.command === 'delete')) {
        parsed.id = arg;
      } else if (!parsed.query && parsed.command === 'search') {
        parsed.query = arg;
      }
    }
  }
  
  return parsed;
}

/**
 * Handle CLI errors gracefully
 * @param {Error} error - Error object
 * @param {string} operation - Operation that failed
 */
export function handleError(error, operation = 'operation') {
  console.error(formatError(error));
  
  if (error.message.includes('not found')) {
    console.log('\n💡 Try running "todo list" to see available tasks');
  } else if (error.message.includes('Invalid task')) {
    console.log('\n💡 Make sure to provide a valid task description');
  } else if (error.message.includes('database')) {
    console.log('\n💡 Check if the database file is accessible and not corrupted');
  }
  
  process.exit(1);
}

/**
 * Display help information
 */
export function displayHelp() {
  console.log(`
📋 To-Do App Help

This is a complete To-Do application built with Codex-Flow framework.

Available Commands:

  add <description>     Add a new task
  list                  List all tasks
  complete <id>         Mark a task as completed
  delete <id>           Delete a task
  search <query>        Search for tasks
  stats                 Show task statistics
  clear                 Clear all tasks
  help                  Show this help

Options:

  -a, --agent          Use Codex-Flow agents
  -f, --force          Skip confirmation prompts
  -s, --status <status> Filter by status (pending, completed)
  --sort <field>       Sort by field (createdAt, description)
  --order <order>      Sort order (asc, desc)

Examples:

  todo add "Buy milk"
  todo list --status pending
  todo complete 1
  todo delete 1 --force
  todo search "milk"
  todo stats

Codex-Flow Integration:

  todo add "Buy milk" --agent
  todo list --agent
  todo complete 1 --agent
  todo delete 1 --agent

For more information, visit: https://github.com/Hulupeep/codex-flow
  `);
}

/**
 * Display task list
 * @param {Array} tasks - Array of tasks
 * @param {string} title - List title
 */
export function displayTaskList(tasks, title = 'To-Do List') {
  if (tasks.length === 0) {
    console.log(`📋 ${title} (0 tasks)`);
    console.log('No tasks found. Add one with: todo add "your task"');
    return;
  }

  const completed = tasks.filter(task => task.status === 'completed');
  const pending = tasks.filter(task => task.status === 'pending');

  console.log(`📋 ${title} (${tasks.length} tasks)`);
  console.log();

  if (completed.length > 0) {
    console.log(`✅ Completed (${completed.length} tasks):`);
    completed.forEach(task => console.log(`  ${formatTask(task)}`));
    console.log();
  }

  if (pending.length > 0) {
    console.log(`⏳ Pending (${pending.length} tasks):`);
    pending.forEach(task => console.log(`  ${formatTask(task)}`));
  }
}

/**
 * Display task statistics
 * @param {Object} stats - Statistics object
 */
export function displayStatistics(stats) {
  console.log('📊 Task Statistics');
  console.log();
  console.log(`Total tasks: ${stats.total}`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Pending: ${stats.pending}`);
  console.log(`Completion rate: ${stats.completionRate}%`);
}

/**
 * Confirm action
 * @param {string} message - Confirmation message
 * @returns {boolean} True if confirmed
 */
export function confirmAction(message) {
  // In a real CLI, this would read from stdin
  // For now, we'll assume confirmation is handled by the --force flag
  return false;
}

/**
 * Load environment variables
 * @param {string} envPath - Path to .env file
 */
export function loadEnv(envPath = '.env') {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        const value = valueParts.join('=').trim();
        if (key && value) {
          process.env[key] = value;
        }
      }
    });
  } catch (error) {
    // .env file doesn't exist, that's okay
  }
}
