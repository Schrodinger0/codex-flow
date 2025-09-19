/**
 * Jest Setup File
 * Global test configuration and setup
 */

import { beforeAll, afterAll } from '@jest/globals';
import { closeDatabase } from '../lib/storage.js';

// Global test setup
beforeAll(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = './test-data/todos-test.db';
});

// Global test cleanup
afterAll(() => {
  // Close database connections
  closeDatabase();
});

// Extend expect with custom matchers
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
