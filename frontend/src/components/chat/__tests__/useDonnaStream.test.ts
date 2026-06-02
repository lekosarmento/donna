import { renderHook, act } from '@testing-library/react';
import { useDonnaStream } from '../useDonnaStream.js';
import React from 'react';

describe('useDonnaStream React Hook Unit Tests', () => {
  let mockContainer: HTMLDivElement;
  let containerRef: React.RefObject<HTMLDivElement | null>;

  beforeEach(() => {
    // Inicializa elemento DOM mockado para mutação direta do hook
    mockContainer = document.createElement('div');
    containerRef = { current: mockContainer };
    jest.clearAllMocks();
  });

  it('deve processar o stream SSE de forma correta modificando o textContent do DOM diretamente e atualizando estados', async () => {
    // 1. Simular os pedaços (chunks) codificados do ReadableStream em formato SSE
    const sseFrames = [
      'data: {"type":"thinking","tool":"pje_buscar_processo"}\n\n',
      'data: {"type":"token","content":"Olá Dr. "}\n\n',
      'data: {"type":"token","content":"Advogado!"}\n\n',
      'data: {"type":"tool_done","tool":"pje_buscar_processo"}\n\n',
      'data: {"type":"done","usage":{"input_tokens":12,"output_tokens":35}}\n\n'
    ];

    let chunkIndex = 0;

    // 2. Mock do Reader do ReadableStream
    const mockReader = {
      read: jest.fn().mockImplementation(() => {
        if (chunkIndex < sseFrames.length) {
          const encoder = new TextEncoder();
          const encoded = encoder.encode(sseFrames[chunkIndex++]);
          return Promise.resolve({ done: false, value: encoded });
        }
        return Promise.resolve({ done: true, value: undefined });
      })
    };

    // 3. Mock do fetch global do navegador
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => mockReader
      }
    };
    
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    // 4. Renderizar o hook
    const onDoneMock = jest.fn();
    const { result } = renderHook(() => useDonnaStream({
      containerRef,
      onDone: onDoneMock
    }));

    // Verificar estado inicial
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.thinking).toBe(false);

    // 5. Executar o stream sob act para tratar atualizações de estado do React
    await act(async () => {
      await result.current.startStream('buscar processo 0800123', 'session-123', 'user-456');
    });

    // 6. Asserções e Validações
    // Mutação direta do textContent sem re-render (a ref deve ter o texto acumulado completo)
    expect(mockContainer.textContent).toBe('Olá Dr. Advogado!');
    
    // Relação de ferramentas executadas coletada
    expect(result.current.toolsUsed).toContain('pje_buscar_processo');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.thinking).toBe(false);

    // Callback final disparado com os metadados de tokens obtidos
    expect(onDoneMock).toHaveBeenCalledWith('Olá Dr. Advogado!', {
      input_tokens: 12,
      output_tokens: 35
    });
  });

  it('deve tratar erros retornados pelo stream SSE de forma correta', async () => {
    const errorFrame = 'data: {"type":"error","message":"Falha ao autenticar certificado A1 no tribunal"}\n\n';
    const encoder = new TextEncoder();

    const mockReader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(errorFrame) })
        .mockResolvedValueOnce({ done: true, value: undefined })
    };

    const mockResponse = {
      ok: true,
      body: {
        getReader: () => mockReader
      }
    };
    
    global.fetch = jest.fn().mockResolvedValue(mockResponse);
    const onErrorMock = jest.fn();

    const { result } = renderHook(() => useDonnaStream({
      containerRef,
      onError: onErrorMock
    }));

    await act(async () => {
      await result.current.startStream('buscar processo', 'sessao-1', 'operador-1');
    });

    expect(result.current.error).toBe('Falha ao autenticar certificado A1 no tribunal');
    expect(result.current.isStreaming).toBe(false);
    expect(onErrorMock).toHaveBeenCalledWith(expect.any(Error));
  });
});
