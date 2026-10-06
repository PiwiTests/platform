import { describe, expect, it } from 'vitest';
import { isOtelTracingEnabled } from '../../server/utils/otel';

describe('OpenTelemetry tracing switch', () => {
  it('is off with no OTLP endpoint', () => {
    expect(isOtelTracingEnabled({})).toBe(false);
    expect(isOtelTracingEnabled({ OTEL_SERVICE_NAME: 'piwi' })).toBe(false);
  });

  it('is on once an OTLP endpoint is set', () => {
    expect(isOtelTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' })).toBe(true);
    expect(isOtelTracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces' })).toBe(true);
  });

  it('honors OTEL_SDK_DISABLED', () => {
    expect(
      isOtelTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_SDK_DISABLED: 'true' }),
    ).toBe(false);
  });
});
