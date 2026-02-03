/**
 * Unit tests for Ollama adapter
 */

import { describe, it, expect } from 'vitest';
import {
  extractMessagesFromOllama,
  convertIntentToOllama,
  convertErrorToOllama,
} from '../../src/adapters/ollamaAdapter.js';
import type { OllamaChatRequest } from '../../src/types/ollama.js';
import type { Intent } from '../../src/types/intent.js';
import { HA_TOOLS } from '../../src/types/intent.js';

describe('Ollama Adapter', () => {
  describe('extractMessagesFromOllama', () => {
    it('should extract system context and user message', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Available entities:\n- light.living_room: Living Room Light\n- switch.fan: Fan',
          },
          {
            role: 'user',
            content: 'turn on the living room light',
          },
        ],
      };

      const result = extractMessagesFromOllama(request);

      expect(result.systemContext).toBe(
        'Available entities:\n- light.living_room: Living Room Light\n- switch.fan: Fan'
      );
      expect(result.userMessage).toBe('turn on the living room light');
    });

    it('should handle multiple system messages', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Context line 1' },
          { role: 'system', content: 'Context line 2' },
          { role: 'user', content: 'test message' },
        ],
      };

      const result = extractMessagesFromOllama(request);

      expect(result.systemContext).toBe('Context line 1\nContext line 2');
      expect(result.userMessage).toBe('test message');
    });

    it('should handle missing system context', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test message' }],
      };

      const result = extractMessagesFromOllama(request);

      expect(result.systemContext).toBe('');
      expect(result.userMessage).toBe('test message');
    });
  });

  describe('convertIntentToOllama', () => {
    it('should convert turn_on intent to Ollama format', () => {
      const intent: Intent = {
        intent: 'turn_on',
        domain: 'light',
        entity_id: 'light.living_room',
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 100);

      expect(response.model).toBe('gpt-4o');
      expect(response.done).toBe(true);
      expect(response.done_reason).toBe('stop');
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('');
      expect(response.message.tool_calls).toBeDefined();
      expect(response.message.tool_calls).toHaveLength(1);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.name).toBe(HA_TOOLS.TURN_ON);
      
      // CRITICAL: arguments must be an Object, not a string
      expect(typeof toolCall.function.arguments).toBe('object');
      expect(toolCall.function.arguments).toEqual({
        name: 'light.living_room',
      });

      // Check timing metadata is in nanoseconds
      expect(response.total_duration).toBe(100 * 1_000_000);
    });

    it('should convert turn_off intent to Ollama format', () => {
      const intent: Intent = {
        intent: 'turn_off',
        domain: 'switch',
        entity_id: 'switch.fan',
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 150);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.name).toBe(HA_TOOLS.TURN_OFF);
      expect(toolCall.function.arguments).toEqual({
        name: 'switch.fan',
      });
    });

    it('should include attributes in tool arguments', () => {
      const intent: Intent = {
        intent: 'set_brightness',
        domain: 'light',
        entity_id: 'light.bedroom',
        attributes: {
          brightness: 80,
        },
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 200);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.name).toBe(HA_TOOLS.LIGHT_SET);
      expect(toolCall.function.arguments).toEqual({
        name: 'light.bedroom',
        brightness: 80,
      });
    });

    it('should throw error for unknown intent', () => {
      const intent: Intent = {
        intent: 'unknown',
        domain: 'unknown',
        entity_id: '',
      };

      expect(() => {
        convertIntentToOllama(intent, 'gpt-4o', 100);
      }).toThrow('Unknown or unsupported intent: unknown');
    });

    it('should validate created_at is ISO 8601 format', () => {
      const intent: Intent = {
        intent: 'turn_on',
        domain: 'light',
        entity_id: 'light.test',
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 100);

      // Check if created_at is valid ISO 8601
      const date = new Date(response.created_at);
      expect(date.toISOString()).toBe(response.created_at);
    });

    it('should have all required timing fields', () => {
      const intent: Intent = {
        intent: 'turn_on',
        domain: 'light',
        entity_id: 'light.test',
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 123);

      expect(response.total_duration).toBe(123 * 1_000_000);
      expect(response.eval_duration).toBe(123 * 1_000_000);
      expect(response.eval_count).toBe(1);
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

  describe('Intent to Tool Name Mapping', () => {
    it('should map set_temperature to correct tool', () => {
      const intent: Intent = {
        intent: 'set_temperature',
        domain: 'climate',
        entity_id: 'climate.living_room',
        attributes: {
          temperature: 22,
        },
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 100);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.name).toBe(HA_TOOLS.LIGHT_SET);
      expect(toolCall.function.arguments).toEqual({
        name: 'climate.living_room',
        temperature: 22,
      });
    });

    it('should preserve all custom attributes', () => {
      const intent: Intent = {
        intent: 'turn_on',
        domain: 'light',
        entity_id: 'light.test',
        attributes: {
          brightness: 100,
          color_temp: 4000,
          transition: 2,
        },
      };

      const response = convertIntentToOllama(intent, 'gpt-4o', 100);

      const toolCall = response.message.tool_calls![0];
      expect(toolCall.function.arguments).toEqual({
        name: 'light.test',
        brightness: 100,
        color_temp: 4000,
        transition: 2,
      });
    });
  });
});
