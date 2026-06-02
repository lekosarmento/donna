import { useState, useCallback, useRef } from 'react';

export interface UseDonnaStreamOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  onDone?: (fullText: string, usage?: { input_tokens: number; output_tokens: number }) => void;
  onError?: (err: Error) => void;
}

export interface UseDonnaStreamResult {
  startStream: (message: string, sessionId: string, userId: string) => Promise<void>;
  thinking: boolean;
  activeTool: string | null;
  toolsUsed: string[];
  isStreaming: boolean;
  error: string | null;
}

/**
 * Hook customizado para consumo de eventos em tempo real (Server-Sent Events) do copiloto Donna.
 * Utiliza mutações de DOM diretas via Ref para evitar ciclos de re-renderização do React
 * durante o streaming de tokens, garantindo performance de 60fps.
 */
export function useDonnaStream({
  containerRef,
  onDone,
  onError,
}: UseDonnaStreamOptions): UseDonnaStreamResult {
  const [thinking, setThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accumulatedTextRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    async (message: string, sessionId: string, userId: string) => {
      // Cancelar qualquer stream anterior ativo
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Resetar estados
      setThinking(false);
      setActiveTool(null);
      setToolsUsed([]);
      setIsStreaming(true);
      setError(null);
      accumulatedTextRef.current = '';

      if (containerRef.current) {
        containerRef.current.textContent = '';
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch('http://localhost:3000/api/donna/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': `STREAM-${Date.now()}`
          },
          body: JSON.stringify({ message, sessionId, userId }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`Erro na conexão com a Donna: HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('ReadableStream não suportado ou indisponível na resposta.');
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          
          // Manter a última linha incompleta no buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data: ')) continue;

            const jsonStr = trimmedLine.substring(6).trim();
            
            if (jsonStr === '[DONE]') {
              setIsStreaming(false);
              if (onDone) {
                onDone(accumulatedTextRef.current);
              }
              continue;
            }

            try {
              const event = JSON.parse(jsonStr);

              switch (event.type) {
                case 'token':
                  // Performance lock: Append direto no DOM para evitar re-render pesado no React
                  accumulatedTextRef.current += event.content;
                  if (containerRef.current) {
                    containerRef.current.textContent = accumulatedTextRef.current;
                  }
                  break;

                case 'thinking':
                  setThinking(true);
                  setActiveTool(event.tool);
                  setToolsUsed((prev) => [...prev, event.tool]);
                  break;

                case 'tool_done':
                  setThinking(false);
                  setActiveTool(null);
                  break;

                case 'ping':
                  // Heartbeat de rede para manter socket vivo
                  break;

                case 'done':
                  setIsStreaming(false);
                  if (onDone) {
                    onDone(accumulatedTextRef.current, event.usage);
                  }
                  break;

                case 'error':
                  setError(event.message);
                  setIsStreaming(false);
                  if (onError) {
                    onError(new Error(event.message));
                  }
                  break;

                default:
                  break;
              }
            } catch (jsonErr) {
              console.error('[SSE Parser] Falha ao decodificar frame de dados:', jsonStr, jsonErr);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[SSE Stream] Requisição abortada pelo operador.');
          return;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        setError(errMsg);
        setIsStreaming(false);
        if (onError) {
          onError(err instanceof Error ? err : new Error(errMsg));
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [containerRef, onDone, onError]
  );

  return {
    startStream,
    thinking,
    activeTool,
    toolsUsed,
    isStreaming,
    error
  };
}
