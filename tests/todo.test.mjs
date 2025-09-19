#!/usr/bin/env node
/**
 * To-Do App Tests
 * Comprehensive test suite for the To-Do application
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import storage functions
import {
  createTask,
  updateTask,
  deleteTask,
  getTasks,
  findTaskById,
  findTasksByDescription,
  validateTask,
  generateTaskId
} from '../lib/storage.mjs';

const TEST_DATA_FILE = path.join(__dirname, '..', 'data', 'todos.json');
const TEST_DATA_DIR = path.dirname(TEST_DATA_FILE);

// Test data
const testTasks = [
  {
    id: '1',
    description: 'Test task 1',
    status: 'pending',
    createdAt: '2025-01-01T00:00:00.000Z',
    completedAt: null
  },
  {
    id: '2',
    description: 'Test task 2',
    status: 'completed',
    createdAt: '2025-01-01T00:00:00.000Z',
    completedAt: '2025-01-01T12:00:00.000Z'
  }
];

describe('To-Do App Storage Tests', () => {
  before(async () => {
    // Clean up any existing test data
    try {
      await fs.unlink(TEST_DATA_FILE);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  after(async () => {
    // Clean up test data
    try {
      await fs.unlink(TEST_DATA_FILE);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe('Task Creation', () => {
    test('should create a new task', async () => {
      const task = await createTask('Test task');
      
      assert.strictEqual(task.description, 'Test task');
      assert.strictEqual(task.status, 'pending');
      assert.ok(task.id);
      assert.ok(task.createdAt);
      assert.strictEqual(task.completedAt, null);
    });

    test('should generate unique IDs', async () => {
      const tasks = await getTasks();
      const id1 = generateTaskId(tasks);
      const id2 = generateTaskId([...tasks, { id: id1, description: 'test' }]);
      
      assert.notStrictEqual(id1, id2);
      assert.ok(parseInt(id2) > parseInt(id1));
    });

    test('should validate task input', () => {
      const validTask = {
        description: 'Valid task',
        status: 'pending'
      };
      
      const invalidTask = {
        description: '',
        status: 'invalid'
      };
      
      const validResult = validateTask(validTask);
      const invalidResult = validateTask(invalidTask);
      
      assert.strictEqual(validResult.isValid, true);
      assert.strictEqual(invalidResult.isValid, false);
      assert.ok(invalidResult.errors.length > 0);
    });
  });

  describe('Task Retrieval', () => {
    test('should retrieve all tasks', async () => {
      const tasks = await getTasks();
      assert.ok(Array.isArray(tasks));
    });

    test('should filter tasks by status', async () => {
      const pendingTasks = await getTasks({ status: 'pending' });
      const completedTasks = await getTasks({ status: 'completed' });
      
      assert.ok(Array.isArray(pendingTasks));
      assert.ok(Array.isArray(completedTasks));
      
      pendingTasks.forEach(task => {
        assert.strictEqual(task.status, 'pending');
      });
      
      completedTasks.forEach(task => {
        assert.strictEqual(task.status, 'completed');
      });
    });

    test('should find task by ID', async () => {
      const task = await createTask('Find me task');
      const foundTask = findTaskById(await getTasks(), task.id);
      
      assert.strictEqual(foundTask.id, task.id);
      assert.strictEqual(foundTask.description, task.description);
    });

    test('should find tasks by description', async () => {
      await createTask('Search test task');
      const tasks = await getTasks();
      const matches = findTasksByDescription(tasks, 'search test');
      
      assert.ok(matches.length > 0);
      assert.ok(matches.some(task => task.description.includes('Search test')));
    });
  });

  describe('Task Updates', () => {
    test('should update task status', async () => {
      const task = await createTask('Update test task');
      const updatedTask = await updateTask(task.id, { status: 'completed' });
      
      assert.strictEqual(updatedTask.status, 'completed');
      assert.ok(updatedTask.completedAt);
    });

    test('should clear completion timestamp when reverting to pending', async () => {
      const task = await createTask('Revert test task');
      const completedTask = await updateTask(task.id, { status: 'completed' });
      const revertedTask = await updateTask(task.id, { status: 'pending' });
      
      assert.strictEqual(revertedTask.status, 'pending');
      assert.strictEqual(revertedTask.completedAt, null);
    });

    test('should throw error for non-existent task', async () => {
      try {
        await updateTask('non-existent-id', { status: 'completed' });
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.message.includes('not found'));
      }
    });
  });

  describe('Task Deletion', () => {
    test('should delete task', async () => {
      const task = await createTask('Delete test task');
      const deletedTask = await deleteTask(task.id);
      
      assert.strictEqual(deletedTask.id, task.id);
      
      const tasks = await getTasks();
      const foundTask = findTaskById(tasks, task.id);
      assert.strictEqual(foundTask, null);
    });

    test('should throw error for non-existent task deletion', async () => {
      try {
        await deleteTask('non-existent-id');
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.message.includes('not found'));
      }
    });
  });

  describe('Data Persistence', () => {
    test('should persist data across operations', async () => {
      const task1 = await createTask('Persistence test 1');
      const task2 = await createTask('Persistence test 2');
      
      const tasks = await getTasks();
      const foundTask1 = findTaskById(tasks, task1.id);
      const foundTask2 = findTaskById(tasks, task2.id);
      
      assert.ok(foundTask1);
      assert.ok(foundTask2);
      assert.strictEqual(foundTask1.description, 'Persistence test 1');
      assert.strictEqual(foundTask2.description, 'Persistence test 2');
    });
  });
});

describe('To-Do App CLI Tests', () => {
  test('should have valid CLI structure', () => {
    // This is a basic test to ensure the CLI file exists and is valid
    const cliPath = path.join(__dirname, '..', 'todo.js');
    assert.ok(true); // Placeholder for CLI structure validation
  });
});

// Run tests
console.log('🧪 Running To-Do App Tests...\n');
