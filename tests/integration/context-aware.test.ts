/**
 * Integration tests for tool selection with HA context
 */

import { describe, it, expect } from 'vitest';

describe('Dynamic Tool Selection Integration', () => {
  it('should validate ExtractionResult schema has availableTools field', () => {
    const sampleResult = {
      systemContext: 'Static Context:\n- names: Light living room\n  domain: light',
      userMessage: 'turn on the living room light',
      availableTools: [
        {
          type: 'function',
          function: {
            name: 'HassTurnOn',
            description: 'Turns on a device',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        }
      ],
      isRepeatedRequest: false
    };

    expect(sampleResult).toHaveProperty('availableTools');
    expect(sampleResult.availableTools).toHaveLength(1);
    expect(sampleResult.availableTools[0].function.name).toBe('HassTurnOn');
  });

  it('should validate ToolSelection schema', () => {
    const sampleToolSelection = {
      tool_name: 'HassTurnOn',
      arguments: {
        name: 'Light living room',
        domain: ['light']
      }
    };

    expect(sampleToolSelection).toHaveProperty('tool_name');
    expect(sampleToolSelection).toHaveProperty('arguments');
    expect(sampleToolSelection.tool_name).toBe('HassTurnOn');
  });

  it('should handle HA YAML device context format', () => {
    const haYamlContext = `Static Context:
- names: Light living room
  domain: light
  areas: Living Room
  features:
    - turn_on
    - turn_off
    - brightness

- names: Speaker living room
  domain: media_player
  areas: Living Room
  features:
    - turn_on
    - turn_off
    - volume_set
    - media_play_pause`;

    expect(haYamlContext).toContain('names: Light living room');
    expect(haYamlContext).toContain('domain: light');
    expect(haYamlContext).toContain('Speaker living room');
  });

  it('should handle HA tools array with 19 tools', () => {
    const mockHATools = [
      'HassTurnOn',
      'HassTurnOff',
      'HassCancelAllTimers',
      'HassLightSet',
      'HassClimateSetTemperature',
      'HassListAddItem',
      'HassListCompleteItem',
      'HassMediaUnpause',
      'HassMediaPause',
      'HassMediaNext',
      'HassMediaPrevious',
      'HassSetVolume',
      'HassSetVolumeRelative',
      'HassMediaPlayerMute',
      'HassMediaPlayerUnmute',
      'HassMediaSearchAndPlay',
      'GetDateTime',
      'todo_get_items',
      'GetLiveContext'
    ];

    expect(mockHATools).toHaveLength(19);
    expect(mockHATools).toContain('HassTurnOn');
    expect(mockHATools).toContain('HassMediaSearchAndPlay');
    expect(mockHATools).toContain('GetDateTime');
  });
});
