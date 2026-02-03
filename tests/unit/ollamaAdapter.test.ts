/**
 * Unit tests for Ollama adapter with tool selection
 */

import { describe, it, expect } from 'vitest';
import {
  extractMessagesAndTools,
  convertToolSelectionToOllama,
  convertErrorToOllama,
} from '../../src/adapters/ollamaAdapter.js';
import type { OllamaChatRequest, OllamaTool } from '../../src/types/ollama.js';
import type { ToolSelection } from '../../src/types/tool-selection.js';

// Sample tools for testing (mimicking HA's tools)
const sampleTools: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'HassTurnOn',
      description: 'Turns on/opens a device or entity',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          name: { type: 'string', description: 'Name of device' },
          domain: { type: 'array', items: { type: 'string' }, description: 'Domain of device' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'HassTurnOff',
      description: 'Turns off/closes a device or entity',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          name: { type: 'string', description: 'Name of device' },
          domain: { type: 'array', items: { type: 'string' }, description: 'Domain of device' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'HassLightSet',
      description: 'Sets brightness or color of a light',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          name: { type: 'string' },
          brightness: { type: 'number', description: 'Brightness 0-100' },
          color: { type: 'string' }
        }
      }
    }
  }
];

describe('Ollama Adapter - Tool Selection', () => {
  describe('extractMessagesAndTools', () => {
    it('should extract system context, user message, and tools', () => {
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
        tools: sampleTools
      };

      const result = extractMessagesAndTools(request);

      expect(result.systemContext).toBe('Static Context:\n- names: Light living room\n  domain: light');
      expect(result.userMessage).toBe('turn on the living room light');
      expect(result.availableTools).toHaveLength(3);
      expect(result.availableTools[0].function.name).toBe('HassTurnOn');
      expect(result.isRepeatedRequest).toBe(false);
    });

    it('should handle request without tools', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'test message' }
        ]
      };

      const result = extractMessagesAndTools(request);

      expect(result.availableTools).toHaveLength(0);
      expect(result.userMessage).toBe('test message');
    });

    it('should detect repeated request pattern', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'turn on light' },
          { 
            role: 'assistant', 
            content: 'Turned on Light',
            tool_calls: [{ 
              function: { name: 'HassTurnOn', arguments: { name: 'Light' } } 
            }]
          },
          { role: 'tool', content: 'success' },
        ]
      };

      const result = extractMessagesAndTools(request);

      expect(result.isRepeatedRequest).toBe(true);
    });

    it('should handle multiple system messages', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Context line 1' },
          { role: 'system', content: 'Context line 2' },
          { role: 'user', content: 'test message' },
        ],
        tools: []
      };

      const result = extractMessagesAndTools(request);

      expect(result.systemContext).toBe('Context line 1\nContext line 2');
      expect(result.userMessage).toBe('test message');
    });
  });

  describe('convertToolSelectionToOllama', () => {
    it('should convert valid tool selection to Ollama response', () => {
      const toolSelection: ToolSelection = {
        tool_name: 'HassTurnOn',
        arguments: {
          name: 'Light living room',
          domain: ['light']
        }
      };

      const response = convertToolSelectionToOllama(toolSelection, 'gpt-4o', 100);

      expect(response.model).toBe('gpt-4o');
      expect(response.done).toBe(true);
      expect(response.done_reason).toBe('stop');
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toContain('Turned on');
      expect(response.message.tool_calls).toBeDefined();
      expect(response.message.tool_calls).toHaveLength(1);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.name).toBe('HassTurnOn');
      
      // CRITICAL: arguments must be an Object, not a string
      expect(typeof toolCall.function.arguments).toBe('object');
      expect(toolCall.function.arguments).toEqual({
        name: 'Light living room',
        domain: ['light']
      });

      // Check timing metadata is in nanoseconds
      expect(response.total_duration).toBe(100 * 1_000_000);
    });

    it('should handle unknown tool gracefully', () => {
      const toolSelection: ToolSelection = {
        tool_name: 'unknown',
        arguments: {}
      };

      const response = convertToolSelectionToOllama(toolSelection, 'gpt-4o', 100);

      expect(response.message.content).toContain('couldn\'t understand');
      expect(response.message.tool_calls).toBeUndefined();
      expect(response.done).toBe(true);
    });

    it('should generate appropriate confirmation messages for different tools', () => {
      const testCases = [
        { 
          tool: 'HassTurnOn', 
          args: { name: 'Light' }, 
          expected: 'Turned on Light' 
        },
        { 
          tool: 'HassTurnOff', 
          args: { name: 'Fan' }, 
          expected: 'Turned off Fan' 
        },
        { 
          tool: 'HassLightSet', 
          args: { name: 'Light', brightness: 50 }, 
          expected: 'brightness to 50%' 
        },
        { 
          tool: 'HassMediaPause', 
          args: { name: 'Speaker' }, 
          expected: 'Paused Speaker' 
        },
        { 
          tool: 'HassListAddItem', 
          args: { item: 'milk', name: 'Shopping' }, 
          expected: 'Added "milk"' 
        },
      ];

      testCases.forEach(({ tool, args, expected }) => {
        const response = convertToolSelectionToOllama(
          { tool_name: tool, arguments: args },
          'gpt-4o',
          100
        );
        expect(response.message.content).toContain(expected);
      });
    });

    it('should validate created_at is ISO 8601 format', () => {
      const toolSelection: ToolSelection = {
        tool_name: 'HassTurnOn',
        arguments: { name: 'Light' }
      };

      const response = convertToolSelectionToOllama(toolSelection, 'gpt-4o', 100);

      // Check if created_at is valid ISO 8601
      const date = new Date(response.created_at);
      expect(date.toISOString()).toBe(response.created_at);
    });

    it('should have all required timing fields', () => {
      const toolSelection: ToolSelection = {
        tool_name: 'HassTurnOn',
        arguments: { name: 'Light' }
      };

      const response = convertToolSelectionToOllama(toolSelection, 'gpt-4o', 123);

      expect(response.total_duration).toBe(123 * 1_000_000);
      expect(response.eval_duration).toBe(123 * 1_000_000);
      expect(response.eval_count).toBe(1);
    });

    it('should preserve all tool arguments', () => {
      const toolSelection: ToolSelection = {
        tool_name: 'HassLightSet',
        arguments: {
          name: 'Light bedroom',
          brightness: 80,
          color: 'blue',
          transition: 2
        }
      };

      const response = convertToolSelectionToOllama(toolSelection, 'gpt-4o', 100);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.arguments).toEqual({
        name: 'Light bedroom',
        brightness: 80,
        color: 'blue',
        transition: 2
      });
    });
  });

  describe('convertErrorToOllama', () => {
    it('should convert error to Ollama response format', () => {
      const error = new Error('Test error message');
      const response = convertErrorToOllama(error, 'gpt-4o');

      expect(response.model).toBe('gpt-4o');
      expect(response.done).toBe(true);
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Error: Test error message');
      expect(response.message.tool_calls).toBeUndefined();
    });
  });
});
