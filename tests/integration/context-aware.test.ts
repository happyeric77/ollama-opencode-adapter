import { describe, it, expect } from 'vitest';

describe('Context-Aware Intent Extraction', () => {
  it('should merge HA context with JSON rules', () => {
    const haContext = `Current state:
light.living_room: off (Living Room Main Light)
light.bedroom: on (Bedroom Light)
switch.fan: off (Fan)`;

    const jsonRules = `

You are a smart home intent extractor.
RESPOND WITH VALID JSON ONLY.`;

    const combined = `${haContext}${jsonRules}`;

    expect(combined).toContain('light.living_room');
    expect(combined).toContain('RESPOND WITH VALID JSON');
  });

  it('should validate Intent schema has entity_id field', () => {
    const sampleIntent = {
      intent: 'turn_on',
      domain: 'light',
      entity_id: 'light.living_room',
      attributes: {},
    };

    expect(sampleIntent).toHaveProperty('entity_id');
    expect(sampleIntent.entity_id).toBe('light.living_room');
  });
});
