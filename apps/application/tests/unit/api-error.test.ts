import { describe, test, expect } from 'vitest';
import { apiError } from '../../server/utils/api-error';

describe('apiError', () => {
  test('defaults the error code from the status', () => {
    expect(apiError({ statusCode: 404, message: 'Run not found' }).data).toEqual({ errorCode: 'NOT_FOUND' });
  });

  test('merges an object passed as data beside the error code', () => {
    const error = apiError({ statusCode: 409, data: { oauthError: 'email-unverified' } });
    expect(error.data).toEqual({ errorCode: 'CONFLICT', oauthError: 'email-unverified' });
  });

  test('folds an array passed as data into issues', () => {
    const issues = [{ path: ['name'], message: 'Required' }];
    expect(apiError({ statusCode: 400, data: issues }).data).toEqual({ errorCode: 'VALIDATION_ERROR', issues });
  });

  test('an explicit error code wins over the one in data', () => {
    const error = apiError({ statusCode: 503, errorCode: 'AI_NOT_CONFIGURED', data: { errorCode: 'CONFLICT' } });
    expect(error.data).toEqual({ errorCode: 'AI_NOT_CONFIGURED' });
  });
});
