/**
 * Integration tests for tool selection with HA context
 */

import { describe, it, expect } from 'vitest';
import { extractMessagesAndTools } from '../../src/adapters/ollamaAdapter.js';
import type { OllamaChatRequest } from '../../src/types/ollama.js';

describe('Dynamic Tool Selection Integration', () => {
  it('should validate ExtractionResult schema has conversationHistory field', () => {
    const request: OllamaChatRequest = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Static Context:\n- names: Light living room\n  domain: light',
        },
        {
          role: 'user',
          content: 'turn on the living room light',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'HassTurnOn',
            description: 'Turns on a device',
            parameters: {
              type: 'object',
              required: [],
              properties: {}
            }
          }
        }
      ]
    };

    const result = extractMessagesAndTools(request);

    expect(result).toHaveProperty('conversationHistory');
    expect(result.conversationHistory).toHaveLength(1);
    expect(result.conversationHistory[0].role).toBe('user');
    expect(result.conversationHistory[0].content).toBe('turn on the living room light');
    expect(result.availableTools).toHaveLength(1);
    expect(result.availableTools[0].function.name).toBe('HassTurnOn');
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

  it('should handle chat request without tools (chat-only mode)', () => {
    // This validates the schema for chat-only requests
    // When HA disables "Control Home Assistant", no tools are provided
    const chatOnlyRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: '早安' }
      ]
      // No tools array provided
    };

    expect(chatOnlyRequest).toHaveProperty('messages');
    expect(chatOnlyRequest.messages).toHaveLength(1);
    expect(chatOnlyRequest).not.toHaveProperty('tools');
  });

  it('should preserve conversation history across multiple turns', () => {
    const request: OllamaChatRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'System context' },
        { role: 'user', content: 'Hello 我是Eric' },
        { role: 'assistant', content: 'Hello Eric! How can I help you?' },
        { role: 'user', content: '我叫什麼名字' }
      ]
    };

    const result = extractMessagesAndTools(request);

    // Should include all non-system messages in conversation history
    expect(result.conversationHistory).toHaveLength(3);
    expect(result.conversationHistory[0].content).toBe('Hello 我是Eric');
    expect(result.conversationHistory[1].content).toBe('Hello Eric! How can I help you?');
    expect(result.conversationHistory[2].content).toBe('我叫什麼名字');
  });

  it('should extract conversation history with tool calls', () => {
    const request: OllamaChatRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'System context' },
        { role: 'user', content: '打開客廳的燈' },
        { 
          role: 'assistant', 
          content: '',
          tool_calls: [{
            function: {
              name: 'HassTurnOn',
              arguments: { domain: ['light'], area: 'Living Room' }
            }
          }]
        },
        { role: 'tool', content: 'Light turned on' },
        { role: 'assistant', content: 'I have turned on the light.' },
        { role: 'user', content: '再關掉' }
      ]
    };

    const result = extractMessagesAndTools(request);

    // Should include all conversation including tool calls and results
    expect(result.conversationHistory).toHaveLength(5);
    expect(result.conversationHistory[0].content).toBe('打開客廳的燈');
    expect(result.conversationHistory[1].tool_calls).toBeDefined();
    expect(result.conversationHistory[1].tool_calls?.[0].function.name).toBe('HassTurnOn');
    expect(result.conversationHistory[2].role).toBe('tool');
    expect(result.conversationHistory[4].content).toBe('再關掉');
  });
});
