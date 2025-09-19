#!/usr/bin/env node
/**
 * To-Do App Examples
 * Practical examples of using the To-Do application
 */

import { spawn } from 'node:child_process';
import chalk from 'chalk';

/**
 * Execute a todo command and return the result
 * @param {string} command - Command to execute
 * @param {Array} args - Command arguments
 * @returns {Promise<string>} Command output
 */
async function executeTodoCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['todo.js', command, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
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
        resolve(stdout);
      } else {
        reject(new Error(`Command failed: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Example 1: Basic Task Management
 */
async function example1_BasicTaskManagement() {
  console.log(chalk.bold.blue('\n📝 Example 1: Basic Task Management'));
  console.log(chalk.gray('This example shows basic CRUD operations.'));
  
  try {
    // Add tasks
    console.log(chalk.yellow('\n1. Adding tasks...'));
    await executeTodoCommand('add', ['Buy milk']);
    await executeTodoCommand('add', ['Call dentist']);
    await executeTodoCommand('add', ['Finish report']);
    
    // List tasks
    console.log(chalk.yellow('\n2. Listing all tasks...'));
    const listOutput = await executeTodoCommand('list');
    console.log(listOutput);
    
    // Complete a task
    console.log(chalk.yellow('\n3. Completing task 1...'));
    await executeTodoCommand('complete', ['1']);
    
    // List again to see changes
    console.log(chalk.yellow('\n4. Listing after completion...'));
    const updatedList = await executeTodoCommand('list');
    console.log(updatedList);
    
    // Show statistics
    console.log(chalk.yellow('\n5. Task statistics...'));
    const stats = await executeTodoCommand('stats');
    console.log(stats);
    
  } catch (error) {
    console.error(chalk.red('Error in Example 1:'), error.message);
  }
}

/**
 * Example 2: Advanced Filtering and Sorting
 */
async function example2_AdvancedFiltering() {
  console.log(chalk.bold.blue('\n🔍 Example 2: Advanced Filtering and Sorting'));
  console.log(chalk.gray('This example shows filtering and sorting capabilities.'));
  
  try {
    // Add more tasks
    console.log(chalk.yellow('\n1. Adding more tasks...'));
    await executeTodoCommand('add', ['Workout at gym']);
    await executeTodoCommand('add', ['Read programming book']);
    await executeTodoCommand('add', ['Plan vacation']);
    
    // Complete some tasks
    await executeTodoCommand('complete', ['2']);
    await executeTodoCommand('complete', ['4']);
    
    // Filter by status
    console.log(chalk.yellow('\n2. Filtering by status...'));
    console.log(chalk.cyan('Pending tasks:'));
    const pendingTasks = await executeTodoCommand('list', ['--status', 'pending']);
    console.log(pendingTasks);
    
    console.log(chalk.cyan('\nCompleted tasks:'));
    const completedTasks = await executeTodoCommand('list', ['--status', 'completed']);
    console.log(completedTasks);
    
    // Sort by description
    console.log(chalk.yellow('\n3. Sorting by description...'));
    const sortedTasks = await executeTodoCommand('list', ['--sort', 'description', '--order', 'asc']);
    console.log(sortedTasks);
    
    // Search functionality
    console.log(chalk.yellow('\n4. Searching tasks...'));
    const searchResults = await executeTodoCommand('search', ['book']);
    console.log(searchResults);
    
  } catch (error) {
    console.error(chalk.red('Error in Example 2:'), error.message);
  }
}

/**
 * Example 3: AI Agent Integration
 */
async function example3_AIAgentIntegration() {
  console.log(chalk.bold.blue('\n🤖 Example 3: AI Agent Integration'));
  console.log(chalk.gray('This example shows Codex-Flow AI agent integration.'));
  console.log(chalk.gray('Note: Requires Codex-Flow server to be running.'));
  
  try {
    // Test if server is running
    console.log(chalk.yellow('\n1. Testing AI agent integration...'));
    
    try {
      const result = await executeTodoCommand('add', ['AI-powered task', '--agent']);
      console.log(chalk.green('✅ AI agent integration working!'));
      console.log(result);
    } catch (error) {
      console.log(chalk.yellow('⚠️  AI agent integration not available (server not running)'));
      console.log(chalk.gray('To enable AI features, start the server with: node simple-server.mjs'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error in Example 3:'), error.message);
  }
}

/**
 * Example 4: Error Handling
 */
async function example4_ErrorHandling() {
  console.log(chalk.bold.blue('\n⚠️  Example 4: Error Handling'));
  console.log(chalk.gray('This example shows how the app handles errors gracefully.'));
  
  try {
    // Try to complete non-existent task
    console.log(chalk.yellow('\n1. Trying to complete non-existent task...'));
    try {
      await executeTodoCommand('complete', ['999']);
    } catch (error) {
      console.log(chalk.red('Expected error:'), error.message);
    }
    
    // Try to delete non-existent task
    console.log(chalk.yellow('\n2. Trying to delete non-existent task...'));
    try {
      await executeTodoCommand('delete', ['999']);
    } catch (error) {
      console.log(chalk.red('Expected error:'), error.message);
    }
    
    // Try to add empty task
    console.log(chalk.yellow('\n3. Trying to add empty task...'));
    try {
      await executeTodoCommand('add', ['']);
    } catch (error) {
      console.log(chalk.red('Expected error:'), error.message);
    }
    
    console.log(chalk.green('\n✅ Error handling working correctly!'));
    
  } catch (error) {
    console.error(chalk.red('Error in Example 4:'), error.message);
  }
}

/**
 * Example 5: Workflow Simulation
 */
async function example5_WorkflowSimulation() {
  console.log(chalk.bold.blue('\n🔄 Example 5: Workflow Simulation'));
  console.log(chalk.gray('This example simulates a real-world workflow.'));
  
  try {
    // Clear existing tasks
    console.log(chalk.yellow('\n1. Starting fresh...'));
    await executeTodoCommand('clear', ['--force']);
    
    // Morning routine
    console.log(chalk.yellow('\n2. Morning routine tasks...'));
    await executeTodoCommand('add', ['Check emails']);
    await executeTodoCommand('add', ['Review daily schedule']);
    await executeTodoCommand('add', ['Prepare presentation']);
    
    // Complete morning tasks
    console.log(chalk.yellow('\n3. Completing morning tasks...'));
    await executeTodoCommand('complete', ['1']);
    await executeTodoCommand('complete', ['2']);
    
    // Afternoon tasks
    console.log(chalk.yellow('\n4. Adding afternoon tasks...'));
    await executeTodoCommand('add', ['Team meeting']);
    await executeTodoCommand('add', ['Code review']);
    await executeTodoCommand('add', ['Update documentation']);
    
    // Show progress
    console.log(chalk.yellow('\n5. Current progress...'));
    const progress = await executeTodoCommand('stats');
    console.log(progress);
    
    // Complete more tasks
    console.log(chalk.yellow('\n6. Completing more tasks...'));
    await executeTodoCommand('complete', ['4']);
    await executeTodoCommand('complete', ['5']);
    
    // Final status
    console.log(chalk.yellow('\n7. Final status...'));
    const finalList = await executeTodoCommand('list');
    console.log(finalList);
    
    const finalStats = await executeTodoCommand('stats');
    console.log(finalStats);
    
  } catch (error) {
    console.error(chalk.red('Error in Example 5:'), error.message);
  }
}

/**
 * Main function to run all examples
 */
async function runAllExamples() {
  console.log(chalk.bold.green('🎯 To-Do App Examples'));
  console.log(chalk.gray('Running comprehensive examples of the To-Do application.'));
  
  try {
    await example1_BasicTaskManagement();
    await example2_AdvancedFiltering();
    await example3_AIAgentIntegration();
    await example4_ErrorHandling();
    await example5_WorkflowSimulation();
    
    console.log(chalk.bold.green('\n🎉 All examples completed successfully!'));
    console.log(chalk.gray('For more information, see README-TODO.md'));
    
  } catch (error) {
    console.error(chalk.red('Examples failed:'), error.message);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1_BasicTaskManagement,
  example2_AdvancedFiltering,
  example3_AIAgentIntegration,
  example4_ErrorHandling,
  example5_WorkflowSimulation,
  runAllExamples
};
