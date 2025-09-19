/**
 * To-Do App Storage Tests
 * Comprehensive Jest test suite for SQLite storage operations
 */

import {
  createTask,
  getTasks,
  findTaskById,
  findTasksByDescription,
  updateTask,
  deleteTask,
  clearAllTasks,
  getTaskStatistics,
  initializeTestDatabase,
  cleanupTestDatabase,
  closeDatabase
} from '../lib/storage.js';

import { validateTask, generateId } from '../lib/utils.js';

// Test database path
const TEST_DB_PATH = './test-data/todos-test.db';

describe('To-Do App Storage Tests', () => {
  beforeAll(() => {
    // Initialize test database
    initializeTestDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    // Cleanup test database
    cleanupTestDatabase();
    closeDatabase();
  });

  beforeEach(async () => {
    // Clear all tasks before each test
    await clearAllTasks();
  });

  describe('Task Creation', () => {
    test('should create a new task with valid data', async () => {
      const task = await createTask('Test task');
      
      expect(task).toBeDefined();
      expect(task.description).toBe('Test task');
      expect(task.status).toBe('pending');
      expect(task.id).toBeDefined();
      expect(task.createdAt).toBeDefined();
      expect(task.completedAt).toBeNull();
    });

    test('should generate unique IDs for different tasks', async () => {
      const task1 = await createTask('Task 1');
      const task2 = await createTask('Task 2');
      
      expect(task1.id).not.toBe(task2.id);
      expect(task1.id).toMatch(/^[a-f0-9]{16}$/i);
      expect(task2.id).toMatch(/^[a-f0-9]{16}$/i);
    });

    test('should trim whitespace from task description', async () => {
      const task = await createTask('  Test task  ');
      
      expect(task.description).toBe('Test task');
    });

    test('should throw error for empty task description', async () => {
      await expect(createTask('')).rejects.toThrow('Invalid task');
      await expect(createTask('   ')).rejects.toThrow('Invalid task');
    });

    test('should throw error for very long task description', async () => {
      const longDescription = 'a'.repeat(501);
      await expect(createTask(longDescription)).rejects.toThrow('Invalid task');
    });
  });

  describe('Task Retrieval', () => {
    beforeEach(async () => {
      // Create test tasks
      await createTask('Task 1');
      await createTask('Task 2');
      await createTask('Task 3');
    });

    test('should retrieve all tasks', async () => {
      const tasks = await getTasks();
      
      expect(tasks).toHaveLength(3);
      expect(tasks[0]).toHaveProperty('id');
      expect(tasks[0]).toHaveProperty('description');
      expect(tasks[0]).toHaveProperty('status');
      expect(tasks[0]).toHaveProperty('createdAt');
    });

    test('should filter tasks by status', async () => {
      const pendingTasks = await getTasks({ status: 'pending' });
      const completedTasks = await getTasks({ status: 'completed' });
      
      expect(pendingTasks).toHaveLength(3);
      expect(completedTasks).toHaveLength(0);
      
      pendingTasks.forEach(task => {
        expect(task.status).toBe('pending');
      });
    });

    test('should sort tasks by creation date', async () => {
      const tasks = await getTasks({ sortBy: 'createdAt', sortOrder: 'ASC' });
      
      expect(tasks).toHaveLength(3);
      for (let i = 1; i < tasks.length; i++) {
        expect(new Date(tasks[i].createdAt)).toBeAfter(new Date(tasks[i - 1].createdAt));
      }
    });

    test('should find task by ID', async () => {
      const tasks = await getTasks();
      const taskId = tasks[0].id;
      
      const foundTask = await findTaskById(taskId);
      
      expect(foundTask).toBeDefined();
      expect(foundTask.id).toBe(taskId);
      expect(foundTask.description).toBe('Task 1');
    });

    test('should return null for non-existent task ID', async () => {
      const foundTask = await findTaskById('non-existent-id');
      
      expect(foundTask).toBeNull();
    });

    test('should find tasks by description', async () => {
      const matches = await findTasksByDescription('Task');
      
      expect(matches).toHaveLength(3);
      matches.forEach(task => {
        expect(task.description).toContain('Task');
      });
    });

    test('should find tasks by partial description', async () => {
      const matches = await findTasksByDescription('1');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].description).toBe('Task 1');
    });

    test('should return empty array for no matches', async () => {
      const matches = await findTasksByDescription('NonExistent');
      
      expect(matches).toHaveLength(0);
    });
  });

  describe('Task Updates', () => {
    let taskId;

    beforeEach(async () => {
      const task = await createTask('Test task');
      taskId = task.id;
    });

    test('should update task status to completed', async () => {
      const updatedTask = await updateTask(taskId, { status: 'completed' });
      
      expect(updatedTask.status).toBe('completed');
      expect(updatedTask.completedAt).toBeDefined();
      expect(updatedTask.description).toBe('Test task');
    });

    test('should update task description', async () => {
      const updatedTask = await updateTask(taskId, { description: 'Updated task' });
      
      expect(updatedTask.description).toBe('Updated task');
      expect(updatedTask.status).toBe('pending');
    });

    test('should clear completion timestamp when reverting to pending', async () => {
      // First complete the task
      await updateTask(taskId, { status: 'completed' });
      
      // Then revert to pending
      const updatedTask = await updateTask(taskId, { status: 'pending' });
      
      expect(updatedTask.status).toBe('pending');
      expect(updatedTask.completedAt).toBeNull();
    });

    test('should throw error for non-existent task', async () => {
      await expect(updateTask('non-existent-id', { status: 'completed' }))
        .rejects.toThrow('not found');
    });

    test('should throw error for invalid status', async () => {
      await expect(updateTask(taskId, { status: 'invalid' }))
        .rejects.toThrow('Invalid task update');
    });

    test('should throw error for empty description', async () => {
      await expect(updateTask(taskId, { description: '' }))
        .rejects.toThrow('Invalid task update');
    });
  });

  describe('Task Deletion', () => {
    let taskId;

    beforeEach(async () => {
      const task = await createTask('Test task');
      taskId = task.id;
    });

    test('should delete task by ID', async () => {
      const deletedTask = await deleteTask(taskId);
      
      expect(deletedTask.id).toBe(taskId);
      expect(deletedTask.description).toBe('Test task');
      
      // Verify task is deleted
      const foundTask = await findTaskById(taskId);
      expect(foundTask).toBeNull();
    });

    test('should throw error for non-existent task', async () => {
      await expect(deleteTask('non-existent-id'))
        .rejects.toThrow('not found');
    });

    test('should not affect other tasks when deleting', async () => {
      const task2 = await createTask('Task 2');
      
      await deleteTask(taskId);
      
      const remainingTasks = await getTasks();
      expect(remainingTasks).toHaveLength(1);
      expect(remainingTasks[0].id).toBe(task2.id);
    });
  });

  describe('Bulk Operations', () => {
    beforeEach(async () => {
      // Create multiple tasks
      await createTask('Task 1');
      await createTask('Task 2');
      await createTask('Task 3');
    });

    test('should clear all tasks', async () => {
      const deletedCount = await clearAllTasks();
      
      expect(deletedCount).toBe(3);
      
      const remainingTasks = await getTasks();
      expect(remainingTasks).toHaveLength(0);
    });

    test('should return 0 when clearing empty database', async () => {
      await clearAllTasks(); // Clear existing tasks
      
      const deletedCount = await clearAllTasks();
      expect(deletedCount).toBe(0);
    });
  });

  describe('Task Statistics', () => {
    test('should return correct statistics for empty database', async () => {
      const stats = await getTaskStatistics();
      
      expect(stats.total).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.completionRate).toBe(0);
    });

    test('should return correct statistics with mixed tasks', async () => {
      // Create tasks
      const task1 = await createTask('Task 1');
      const task2 = await createTask('Task 2');
      const task3 = await createTask('Task 3');
      
      // Complete one task
      await updateTask(task1.id, { status: 'completed' });
      
      const stats = await getTaskStatistics();
      
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(2);
      expect(stats.completionRate).toBe(33);
    });

    test('should return 100% completion rate for all completed tasks', async () => {
      const task1 = await createTask('Task 1');
      const task2 = await createTask('Task 2');
      
      await updateTask(task1.id, { status: 'completed' });
      await updateTask(task2.id, { status: 'completed' });
      
      const stats = await getTaskStatistics();
      
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.pending).toBe(0);
      expect(stats.completionRate).toBe(100);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle concurrent task creation', async () => {
      const promises = Array(10).fill().map((_, i) => createTask(`Task ${i}`));
      
      const tasks = await Promise.all(promises);
      
      expect(tasks).toHaveLength(10);
      
      // All tasks should have unique IDs
      const ids = tasks.map(task => task.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    test('should handle database connection errors gracefully', async () => {
      // Close database to simulate connection error
      closeDatabase();
      
      await expect(createTask('Test task')).rejects.toThrow();
    });

    test('should validate task data before database operations', async () => {
      const invalidTask = {
        id: '',
        description: '',
        status: 'invalid'
      };
      
      const validation = validateTask(invalidTask);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    test('should handle special characters in task descriptions', async () => {
      const specialChars = 'Task with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const task = await createTask(specialChars);
      
      expect(task.description).toBe(specialChars);
      
      const foundTask = await findTaskById(task.id);
      expect(foundTask.description).toBe(specialChars);
    });
  });

  describe('Data Integrity', () => {
    test('should maintain data integrity across operations', async () => {
      // Create task
      const task = await createTask('Original task');
      
      // Update task
      const updatedTask = await updateTask(task.id, { 
        description: 'Updated task',
        status: 'completed'
      });
      
      // Verify all fields are correct
      expect(updatedTask.id).toBe(task.id);
      expect(updatedTask.description).toBe('Updated task');
      expect(updatedTask.status).toBe('completed');
      expect(updatedTask.completedAt).toBeDefined();
      expect(updatedTask.createdAt).toBe(task.createdAt);
    });

    test('should handle transaction rollback on errors', async () => {
      const task = await createTask('Test task');
      
      // Try to update with invalid data
      await expect(updateTask(task.id, { status: 'invalid' }))
        .rejects.toThrow();
      
      // Verify original task is unchanged
      const originalTask = await findTaskById(task.id);
      expect(originalTask.status).toBe('pending');
      expect(originalTask.description).toBe('Test task');
    });
  });
});

// Custom Jest matchers
expect.extend({
  toBeAfter(received, expected) {
    const pass = new Date(received) > new Date(expected);
    if (pass) {
      return {
        message: () => `expected ${received} not to be after ${expected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be after ${expected}`,
        pass: false,
      };
    }
  },
});
