#!/usr/bin/env node
/**
 * To-Do App Demo Script
 * Demonstrates all features of the To-Do application
 */

import { spawn } from 'node:child_process';
import chalk from 'chalk';

const DEMO_TASKS = [
  'Buy groceries',
  'Call mom',
  'Finish project report',
  'Go to gym',
  'Read book'
];

/**
 * Execute a todo command
 * @param {string} command - Command to execute
 * @param {Array} args - Command arguments
 * @returns {Promise<void>}
 */
async function runTodoCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue(`\n🔧 Running: todo ${command} ${args.join(' ')}`));
    console.log(chalk.gray('─'.repeat(50)));
    
    const child = spawn('node', ['todo.js', command, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Wait for user input
 * @param {string} message - Message to display
 * @returns {Promise<void>}
 */
async function waitForInput(message) {
  return new Promise((resolve) => {
    console.log(chalk.yellow(`\n⏸️  ${message}`));
    console.log(chalk.gray('Press Enter to continue...'));
    
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

/**
 * Main demo function
 */
async function runDemo() {
  console.log(chalk.bold.green('🎉 Welcome to the To-Do App Demo!'));
  console.log(chalk.gray('This demo will showcase all features of the To-Do application.'));
  
  try {
    // Demo 1: Add tasks
    console.log(chalk.bold('\n📝 Demo 1: Adding Tasks'));
    for (const task of DEMO_TASKS) {
      await runTodoCommand('add', [task]);
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
    }
    
    await waitForInput('Tasks added! Let\'s see the list.');
    
    // Demo 2: List tasks
    console.log(chalk.bold('\n📋 Demo 2: Listing Tasks'));
    await runTodoCommand('list');
    
    await waitForInput('Now let\'s complete some tasks.');
    
    // Demo 3: Complete tasks
    console.log(chalk.bold('\n✅ Demo 3: Completing Tasks'));
    await runTodoCommand('complete', ['1']); // Complete first task
    await runTodoCommand('complete', ['3']); // Complete third task
    
    await waitForInput('Let\'s see the updated list.');
    
    // Demo 4: List with filtering
    console.log(chalk.bold('\n🔍 Demo 4: Filtering Tasks'));
    await runTodoCommand('list', ['--status', 'pending']);
    await runTodoCommand('list', ['--status', 'completed']);
    
    await waitForInput('Let\'s search for specific tasks.');
    
    // Demo 5: Search tasks
    console.log(chalk.bold('\n🔍 Demo 5: Searching Tasks'));
    await runTodoCommand('search', ['gym']);
    await runTodoCommand('search', ['project']);
    
    await waitForInput('Let\'s see the statistics.');
    
    // Demo 6: Statistics
    console.log(chalk.bold('\n📊 Demo 6: Task Statistics'));
    await runTodoCommand('stats');
    
    await waitForInput('Now let\'s test the AI agent integration.');
    
    // Demo 7: AI Agent Integration
    console.log(chalk.bold('\n🤖 Demo 7: AI Agent Integration'));
    console.log(chalk.gray('Note: This requires the Codex-Flow server to be running.'));
    
    try {
      await runTodoCommand('add', ['AI-powered task', '--agent']);
    } catch (error) {
      console.log(chalk.yellow('⚠️  AI agent demo skipped (server not running)'));
    }
    
    await waitForInput('Let\'s clean up by deleting a task.');
    
    // Demo 8: Delete task
    console.log(chalk.bold('\n🗑️  Demo 8: Deleting Tasks'));
    await runTodoCommand('delete', ['2', '--force']); // Delete second task
    
    await waitForInput('Let\'s see the final list.');
    
    // Demo 9: Final list
    console.log(chalk.bold('\n📋 Demo 9: Final Task List'));
    await runTodoCommand('list');
    
    // Demo 10: Clear all
    console.log(chalk.bold('\n🧹 Demo 10: Clearing All Tasks'));
    await waitForInput('Finally, let\'s clear all tasks.');
    await runTodoCommand('clear', ['--force']);
    
    console.log(chalk.bold.green('\n🎉 Demo Complete!'));
    console.log(chalk.gray('Thank you for trying the To-Do App!'));
    console.log(chalk.gray('For more information, see README-TODO.md'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Demo failed:'), error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Demo interrupted. Goodbye!'));
  process.exit(0);
});

// Run the demo
runDemo().catch(error => {
  console.error(chalk.red('Demo error:'), error);
  process.exit(1);
});
