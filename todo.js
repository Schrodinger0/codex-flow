#!/usr/bin/env node
/**
 * To-Do App CLI Interface
 * A complete To-Do application using Codex-Flow framework with SQLite persistence
 */

import { program } from 'commander';
import chalk from 'chalk';
import { 
  createTask, 
  updateTask, 
  deleteTask, 
  getTasks, 
  findTaskById, 
  findTasksByDescription,
  clearAllTasks,
  getTaskStatistics,
  closeDatabase
} from './lib/storage.js';

import { 
  formatTask, 
  displayTaskList, 
  displayStatistics, 
  displayHelp,
  handleError,
  parseArgs,
  sanitizeInput,
  isValidTaskId
} from './lib/utils.js';

// Initialize Codex-Flow
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Codex-Flow configuration
const CODEX_URL = process.env.CODEX_URL || 'http://localhost:8787';
const CODEX_FLOW_PATH = path.join(__dirname, 'bin', 'codex-flow.mjs');

/**
 * Execute Codex-Flow command
 * @param {string} command - Command to execute
 * @param {Array} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function executeCodexFlow(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CODEX_FLOW_PATH, command, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          resolve({ success: true, output: stdout });
        }
      } else {
        reject(new Error(`Codex-Flow command failed: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to execute Codex-Flow: ${error.message}`));
    });
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Goodbye!'));
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

// CLI Commands

program
  .name('todo')
  .description('A complete To-Do app using Codex-Flow framework')
  .version('1.0.0');

// Add command
program
  .command('add <description>')
  .description('Add a new task to the to-do list')
  .option('-a, --agent', 'Use Codex-Flow agent for task creation')
  .action(async (description, options) => {
    try {
      const sanitizedDescription = sanitizeInput(description);
      
      if (options.agent) {
        // Use Codex-Flow agent
        const result = await executeCodexFlow('run', [
          '--route', 'add task',
          '--runtime', 'codex',
          '--codex-url', CODEX_URL,
          '--input', `Add task: ${sanitizedDescription}`
        ]);
        
        if (result.success) {
          console.log(chalk.green('✅ Task added using Codex-Flow agent!'));
          console.log(chalk.gray('Agent response:'), result.output);
        } else {
          throw new Error('Agent execution failed');
        }
      } else {
        // Direct storage operation
        const task = await createTask(sanitizedDescription);
        console.log(chalk.green('✅ Task added successfully!'));
        console.log(chalk.gray('Task:'), formatTask(task));
      }
    } catch (error) {
      handleError(error, 'adding task');
    }
  });

// List command
program
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status>', 'Filter by status (pending, completed)')
  .option('-a, --agent', 'Use Codex-Flow agent for listing')
  .option('--sort <field>', 'Sort by field (createdAt, description)', 'createdAt')
  .option('--order <order>', 'Sort order (asc, desc)', 'desc')
  .action(async (options) => {
    try {
      if (options.agent) {
        // Use Codex-Flow agent
        const result = await executeCodexFlow('run', [
          '--route', 'list tasks',
          '--runtime', 'codex',
          '--codex-url', CODEX_URL,
          '--input', `List tasks${options.status ? ` with status: ${options.status}` : ''}`
        ]);
        
        if (result.success) {
          console.log(chalk.green('📋 Tasks retrieved using Codex-Flow agent!'));
          console.log(chalk.gray('Agent response:'), result.output);
        } else {
          throw new Error('Agent execution failed');
        }
      } else {
        // Direct storage operation
        const tasks = await getTasks({
          status: options.status,
          sortBy: options.sort,
          sortOrder: options.order
        });
        
        const title = options.status 
          ? `To-Do List (${options.status})` 
          : 'To-Do List';
        
        displayTaskList(tasks, title);
      }
    } catch (error) {
      handleError(error, 'listing tasks');
    }
  });

// Complete command
program
  .command('complete <identifier>')
  .description('Mark a task as completed')
  .option('-a, --agent', 'Use Codex-Flow agent for completion')
  .action(async (identifier, options) => {
    try {
      if (options.agent) {
        // Use Codex-Flow agent
        const result = await executeCodexFlow('run', [
          '--route', 'complete task',
          '--runtime', 'codex',
          '--codex-url', CODEX_URL,
          '--input', `Complete task: ${identifier}`
        ]);
        
        if (result.success) {
          console.log(chalk.green('✅ Task completed using Codex-Flow agent!'));
          console.log(chalk.gray('Agent response:'), result.output);
        } else {
          throw new Error('Agent execution failed');
        }
      } else {
        // Direct storage operation
        let task;
        
        if (isValidTaskId(identifier)) {
          task = await findTaskById(identifier);
        } else {
          const matches = await findTasksByDescription(identifier);
          if (matches.length === 0) {
            throw new Error(`Task "${identifier}" not found`);
          } else if (matches.length > 1) {
            console.log(chalk.yellow('Multiple tasks found:'));
            matches.forEach(match => console.log(`  ${formatTask(match)}`));
            throw new Error('Please specify the exact task ID');
          } else {
            task = matches[0];
          }
        }
        
        if (!task) {
          throw new Error(`Task "${identifier}" not found`);
        }
        
        if (task.status === 'completed') {
          console.log(chalk.yellow('⚠️  Task is already completed'));
          return;
        }
        
        const updatedTask = await updateTask(task.id, { status: 'completed' });
        console.log(chalk.green('✅ Task completed successfully!'));
        console.log(chalk.gray('Task:'), formatTask(updatedTask));
      }
    } catch (error) {
      handleError(error, 'completing task');
    }
  });

// Delete command
program
  .command('delete <identifier>')
  .description('Delete a task from the to-do list')
  .option('-a, --agent', 'Use Codex-Flow agent for deletion')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (identifier, options) => {
    try {
      if (options.agent) {
        // Use Codex-Flow agent
        const result = await executeCodexFlow('run', [
          '--route', 'delete task',
          '--runtime', 'codex',
          '--codex-url', CODEX_URL,
          '--input', `Delete task: ${identifier}`
        ]);
        
        if (result.success) {
          console.log(chalk.green('✅ Task deleted using Codex-Flow agent!'));
          console.log(chalk.gray('Agent response:'), result.output);
        } else {
          throw new Error('Agent execution failed');
        }
      } else {
        // Direct storage operation
        let task;
        
        if (isValidTaskId(identifier)) {
          task = await findTaskById(identifier);
        } else {
          const matches = await findTasksByDescription(identifier);
          if (matches.length === 0) {
            throw new Error(`Task "${identifier}" not found`);
          } else if (matches.length > 1) {
            console.log(chalk.yellow('Multiple tasks found:'));
            matches.forEach(match => console.log(`  ${formatTask(match)}`));
            throw new Error('Please specify the exact task ID');
          } else {
            task = matches[0];
          }
        }
        
        if (!task) {
          throw new Error(`Task "${identifier}" not found`);
        }
        
        if (!options.force) {
          console.log(chalk.yellow('⚠️  Are you sure you want to delete this task?'));
          console.log(chalk.gray('Task:'), formatTask(task));
          console.log(chalk.gray('Use --force to skip confirmation'));
          return;
        }
        
        const deletedTask = await deleteTask(task.id);
        console.log(chalk.green('✅ Task deleted successfully!'));
        console.log(chalk.gray('Deleted:'), formatTask(deletedTask));
      }
    } catch (error) {
      handleError(error, 'deleting task');
    }
  });

// Search command
program
  .command('search <query>')
  .description('Search for tasks by description')
  .action(async (query) => {
    try {
      const sanitizedQuery = sanitizeInput(query);
      const matches = await findTasksByDescription(sanitizedQuery);
      
      if (matches.length === 0) {
        console.log(chalk.yellow(`No tasks found matching "${sanitizedQuery}"`));
        return;
      }
      
      displayTaskList(matches, `Search Results for "${sanitizedQuery}"`);
    } catch (error) {
      handleError(error, 'searching tasks');
    }
  });

// Stats command
program
  .command('stats')
  .description('Show task statistics')
  .action(async () => {
    try {
      const stats = await getTaskStatistics();
      displayStatistics(stats);
    } catch (error) {
      handleError(error, 'getting statistics');
    }
  });

// Clear command
program
  .command('clear')
  .description('Clear all tasks')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      const tasks = await getTasks();
      
      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks to clear'));
        return;
      }
      
      if (!options.force) {
        console.log(chalk.red('⚠️  Are you sure you want to clear ALL tasks?'));
        console.log(chalk.gray(`This will delete ${tasks.length} tasks`));
        console.log(chalk.gray('Use --force to skip confirmation'));
        return;
      }
      
      const deletedCount = await clearAllTasks();
      console.log(chalk.green(`✅ Cleared ${deletedCount} tasks successfully!`));
    } catch (error) {
      handleError(error, 'clearing tasks');
    }
  });

// Help command
program
  .command('help')
  .description('Show detailed help information')
  .action(() => {
    displayHelp();
  });

// Error handling
program.on('command:*', () => {
  console.error(chalk.red('❌ Invalid command. Use "todo help" for available commands.'));
  process.exit(1);
});

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}