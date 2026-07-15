import { describe, expect, it } from 'vitest'
import { OpenRouterError, parseJsonObject } from '../src/ai/openrouter'

describe('parseJsonObject', () => {
  it('parses a plain JSON object', () => {
    expect(parseJsonObject('{"a": 1}')).toEqual({ a: 1 })
  })

  it('parses JSON wrapped in a ```json fence', () => {
    expect(parseJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it('parses JSON embedded in prose via the balanced-braces fallback', () => {
    expect(parseJsonObject('Here you go: {"a": {"b": 2}} hope that helps')).toEqual(
      { a: { b: 2 } }
    )
  })

  it('throws OpenRouterError when no valid JSON exists', () => {
    expect(() => parseJsonObject('no json here')).toThrowError(OpenRouterError)
  })
})
