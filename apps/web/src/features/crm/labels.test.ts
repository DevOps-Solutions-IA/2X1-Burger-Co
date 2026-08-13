import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@/lib/api';
import { isPermissionDeniedError } from './labels';

test('CRM permission errors are classified without treating other failures as authorization', () => {
  assert.equal(isPermissionDeniedError(new ApiError('Forbidden', 403)), true);
  assert.equal(isPermissionDeniedError(new ApiError('Conflict', 409)), false);
  assert.equal(isPermissionDeniedError(new Error('Forbidden')), false);
  assert.equal(isPermissionDeniedError(null), false);
});
